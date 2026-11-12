# Putting plejar.com behind Cloudflare

Today plejar.com's DNS is at Namecheap and points straight at Render, so none of Cloudflare's firewall,
bot or DDoS protection applies to the site. The `server: cloudflare` header you see comes from Render's
own Cloudflare, not ours. The Flutter app also calls `https://plezar.onrender.com/api/v1/` directly.

Do the parts in order. Parts 1 and 2 are safe at any time; Part 3 locks the server and can take the app
offline if it is done too early.

The server side is already in the code (`utils/cloudflare.js`):

- The visitor's IP is taken from `CF-Connecting-IP`, which Cloudflare sets and visitors can't fake, so the
  login, sign-up, password and application rate limits can no longer be dodged with a fake
  `X-Forwarded-For` header. This works as soon as it is deployed.
- When `CF_ORIGIN_SECRET` is set on Render, requests without the matching `X-Plejar-Origin` header get a
  403 (except `/api/v1/health`, which Render uses to check the service is up). Unset, nothing changes.

## Part 1: move the DNS to Cloudflare

1. Cloudflare dashboard → **Add a domain** → `plejar.com` → **Free** plan.
2. Check the imported DNS records against Namecheap before going further. Keep these:

   | Type | Name | Content | Proxy |
   |---|---|---|---|
   | A | `@` | `216.24.57.1` (Render) | Proxied (orange) |
   | CNAME | `www` | `plezar.onrender.com` | Proxied (orange) |
   | MX | `@` | `mx1.privateemail.com`, priority 10 | DNS only |
   | MX | `@` | `mx2.privateemail.com`, priority 10 | DNS only |
   | TXT | `@` | the SPF record (`v=spf1 include:spf.privateemail.com ~all`) | DNS only |
   | TXT | `default._domainkey` and any other TXT/DKIM/verification records | copy exactly | DNS only |

   Missing mail records mean your Namecheap Private Email stops receiving mail.
3. Namecheap → Domain List → plejar.com → **Nameservers** → **Custom DNS** → enter the two nameservers
   Cloudflare gives you. It can take a few hours; Cloudflare emails you when the domain is active.
4. In Render, check the custom domains `plejar.com` and `www.plejar.com` still show as verified.

## Part 2: security settings (Cloudflare dashboard)

**SSL/TLS**
- Overview → encryption mode **Full (strict)**. (Flexible causes redirect loops with Render.)
- Edge Certificates → **Always Use HTTPS**: on. **Minimum TLS Version**: 1.2.
  **Automatic HTTPS Rewrites**: on. Leave HSTS off here: the site already sends it.

**Security**
- WAF → **Managed rules**: the Cloudflare Free Managed Ruleset is on by default; leave it on.
- WAF → **Rate limiting rules** (one rule on the Free plan):
  - If *URI Path* starts with `/api/v1/auth/` **or** starts with `/api/v1/users/login`
    **or** starts with `/api/v1/users/forgotPassword`
  - 20 requests per 10 seconds per IP → **Block** for 10 seconds.
  This stops floods at Cloudflare; the server's own limits (15–20 tries per 15 minutes) still apply.
- WAF → **Custom rules** (up to 5 free), for example:
  - Block requests to `/.env`, `/.git`, `/wp-admin`, `/wp-login.php`, `/xmlrpc.php` (bots scanning for
    other software's weak spots).
- Settings → **Security level**: Medium. **Browser Integrity Check**: on.
- **Bot Fight Mode: leave OFF.** On the Free plan it can't be turned off for the API, and it can
  challenge the app's requests, which the app can't answer.
- Network → **WebSockets**: on (the chat uses them).

**Optional, later**
- **Turnstile** (free CAPTCHA) on the website's sign-up, login and /apply forms, if bots start
  creating accounts. It needs a small change on the forms and the server; ask for it when needed.

## Part 3: lock the server to Cloudflare

Only after Part 1 is active. Until then anyone can skip Cloudflare by calling `plezar.onrender.com`.

1. **Move the app off the Render address.** In the app's `.env`, change
   `API_BASE_URL=https://plezar.onrender.com/api/v1/` to `API_BASE_URL=https://www.plejar.com/api/v1/`,
   build and release. Do the same for anything else that calls `plezar.onrender.com` (Google sign-in
   settings, payment callbacks, bookmarks you share).
2. **Wait** until people have updated. Older app versions keep calling `plezar.onrender.com` and will stop
   working at step 4, so use a forced update first if the app has one.
3. **Add the header in Cloudflare.** Make a long random secret (for example `openssl rand -hex 32`).
   Rules → **Transform Rules** → **Modify Request Header** → Create rule:
   - When: **All incoming requests**
   - Then: **Set static** header `X-Plejar-Origin` = your secret
4. **Then** in Render → the service → Environment, add `CF_ORIGIN_SECRET` = the same secret, and save
   (Render redeploys).
5. Check: `https://www.plejar.com` and the app work; `https://plezar.onrender.com` answers
   "Please use https://www.plejar.com".

Steps 3 and 4 must stay in that order. If something goes wrong, delete `CF_ORIGIN_SECRET` on Render and
everything works as before. To change the secret, update the Transform Rule and Render together.
