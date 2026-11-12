/**
 * Running behind Cloudflare.
 *
 * realClientIp: every request reaching Render comes through Cloudflare (Render's own, and ours once
 * plejar.com is proxied), and Cloudflare always replaces CF-Connecting-IP with the visitor's address,
 * so unlike X-Forwarded-For a visitor can't fake it. req.ip then holds that address, for the rate
 * limits and the IPs saved on applications, subscribers and activity.
 *
 * originGuard: when CF_ORIGIN_SECRET is set, only requests carrying it in the X-Plejar-Origin header
 * are served. Our Cloudflare adds that header (a Transform Rule), so anyone going straight to
 * plezar.onrender.com, around our firewall rules, is turned away. Leave CF_ORIGIN_SECRET unset until
 * the website and every app version in use call www.plejar.com instead of plezar.onrender.com.
 */
const crypto = require('crypto');
const net = require('net');

const ORIGIN_HEADER = 'x-plejar-origin';
// Render checks the service is up by calling it directly, without Cloudflare
const OPEN_PATHS = ['/api/v1/health'];

exports.realClientIp = (req, res, next) => {
  const ip = String(req.headers['cf-connecting-ip'] || '').trim();
  if (net.isIP(ip)) Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
  next();
};

const sameSecret = (given, secret) => {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a, b);
};

exports.originGuard = (req, res, next) => {
  const secret = process.env.CF_ORIGIN_SECRET;
  if (!secret) return next();
  const given = req.headers[ORIGIN_HEADER];
  // Never passed on to the rest of the app, the logs or error reports
  delete req.headers[ORIGIN_HEADER];
  if (OPEN_PATHS.includes(req.path) || sameSecret(given, secret)) return next();
  res.status(403).type('text/plain').send('Please use https://www.plejar.com');
};
