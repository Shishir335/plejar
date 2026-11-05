const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Caching, to send fewer bytes:
 * - Pages: script, style and tab icon links carry a hash of the file (/js/app.js?v=ab12cd34), so browsers keep
 *   those files for a year and still get the new one right after a deploy.
 * - Public API data: kept in this server's memory for a few minutes, and browsers may reuse it briefly.
 *   Only for routes whose answer is the same for everyone; never for anything signed-in.
 * - Images: read routes hand out Cloudinary URLs for a smaller, modern version of each photo.
 * The memory cache belongs to one server process. A restart simply empties it.
 */

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const YEAR = 365 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;

// ---------- Pages and static files ----------

const shortHash = async file => {
  try {
    return crypto.createHash('md5').update(await fs.promises.readFile(path.join(PUBLIC_DIR, file))).digest('hex').slice(0, 8);
  } catch (err) {
    return null;
  }
};

const ASSET_LINK = /\b(src|href)="(\/?(?:js\/[^"?#]+\.js|css\/[^"?#]+\.css|assets\/favicon[^"?#]*))"/g;

const renderPage = async file => {
  const html = await fs.promises.readFile(path.join(PUBLIC_DIR, file), 'utf8');
  const links = [...new Set([...html.matchAll(ASSET_LINK)].map(m => m[2]))];
  const hashes = new Map(await Promise.all(links.map(async link => [link, await shortHash(link)])));
  return html.replace(ASSET_LINK, (all, attr, link) => (hashes.get(link) ? `${attr}="${link}?v=${hashes.get(link)}"` : all));
};

// Files don't change while the live server runs, so each page is built once. In development, every time.
const builtPages = new Map();
const pageHtml = file => {
  if (process.env.NODE_ENV !== 'production') return renderPage(file);
  if (!builtPages.has(file)) builtPages.set(file, renderPage(file).catch(err => { builtPages.delete(file); throw err; }));
  return builtPages.get(file);
};

/** A route that sends a page from /public. The browser asks each time and gets "not changed" (304) if it hasn't. */
const sendPage = file => (req, res, next) => {
  pageHtml(file).then(html => res.set('Cache-Control', 'no-cache').type('html').send(html)).catch(next);
};

/** Cache-Control for express.static */
const staticHeaders = (res, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (res.req.query.v) res.set('Cache-Control', `public, max-age=${YEAR}, immutable`);
  else if (/^\.(jpe?g|png|webp|gif|svg|ico|mp4|woff2?)$/.test(ext)) res.set('Cache-Control', `public, max-age=${DAY}`);
  else res.set('Cache-Control', 'no-cache');
};

// ---------- API data in memory ----------

const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024;
const store = new Map(); // url -> { body, expires }, oldest use first
let totalBytes = 0;

const forget = key => {
  const entry = store.get(key);
  if (!entry) return;
  totalBytes -= entry.body.length;
  store.delete(key);
};

const remember = (key, body, seconds) => {
  if (body.length > MAX_ENTRY_BYTES) return;
  forget(key);
  store.set(key, { body, expires: Date.now() + seconds * 1000 });
  totalBytes += body.length;
  while (totalBytes > MAX_TOTAL_BYTES) forget(store.keys().next().value);
};

const recall = key => {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    forget(key);
    return null;
  }
  // Move to the end, so the least used are dropped first
  store.delete(key);
  store.set(key, entry);
  return entry.body;
};

const clearCache = () => {
  store.clear();
  totalBytes = 0;
};

/** Every API answer: only this person's own browser may keep it, and it must check first */
const privateByDefault = (req, res, next) => {
  res.set('Cache-Control', 'private, no-cache');
  next();
};

/**
 * For a public GET route whose answer is the same for everyone. Only successful answers are kept.
 * `server`: seconds to keep it in memory; `browser`: seconds a browser may reuse it without asking.
 */
const publicCache = ({ server, browser }) => (req, res, next) => {
  const key = req.originalUrl;
  const cacheControl = `public, max-age=${browser}`;
  const hit = recall(key);
  if (hit) return res.set({ 'Cache-Control': cacheControl, 'X-Cache': 'HIT' }).type('json').send(hit);

  res.set('X-Cache', 'MISS');
  const send = res.send;
  res.send = function (body) {
    if (res.statusCode === 200 && typeof body === 'string') {
      remember(key, body, server);
      res.set('Cache-Control', cacheControl);
    }
    return send.call(this, body);
  };
  next();
};

/** Admins and vendors changing something empties the cache, so their edits show straight away. Chat messages don't. */
const clearAfterWrite = (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.originalUrl.includes('chats')) {
    res.on('finish', () => {
      if (res.statusCode < 400) clearCache();
    });
  }
  next();
};

// ---------- Images ----------

// Best format and quality for the device, and no wider than a phone or laptop screen needs
const IMAGE_TRANSFORM = 'f_auto,q_auto,c_limit,w_1200';
const PLAIN_IMAGE_URL = /(https:\/\/res\.cloudinary\.com\/[^/"]+\/image\/upload\/)(?=v\d+\/)/g;

/**
 * Hand out smaller Cloudinary images. For read routes only: the vendor and admin panels send photo
 * URLs back when removing them, and those have to match what the database holds.
 */
const smallerImages = (req, res, next) => {
  res.json = function (body) {
    const json = JSON.stringify(body);
    if (!this.get('Content-Type')) this.set('Content-Type', 'application/json');
    return this.send(json === undefined ? json : json.replace(PLAIN_IMAGE_URL, `$1${IMAGE_TRANSFORM}/`));
  };
  next();
};

/** The stored URL of an image a client got through smallerImages */
const originalImageUrl = url => String(url).split(`/${IMAGE_TRANSFORM}/`).join('/');

module.exports = { sendPage, staticHeaders, privateByDefault, publicCache, clearAfterWrite, clearCache, smallerImages, originalImageUrl };
