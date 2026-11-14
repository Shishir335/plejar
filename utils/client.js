/**
 * Which Plejar client sent a request: the app or the website. For counting only, never for
 * security: a header is as easy to fake as a URL.
 *
 * The app sends `X-Plejar-Client: app/1.4.2 (android)` (or ios). Without that header, an app build
 * from before it existed is told apart by Dio's user agent ("Dart/3.x (dart:io)"), and browsers
 * (the website and the vendor and admin panels) by theirs.
 *
 * req.client = { type: 'app' | 'web' | 'unknown', version, platform }
 */
const User = require('../models/userModel');

const HEADER = 'x-plejar-client';
const TYPES = ['app', 'web', 'unknown'];
const PLATFORMS = ['android', 'ios', 'web', 'other'];
const SEEN_EVERY_MS = 60 * 60 * 1000; // a user's "last seen on" is saved at most hourly per client

const clean = (value, max) => String(value || '').replace(/[^\w.+-]/g, '').slice(0, max);

const readClient = req => {
  const header = String((req.headers && req.headers[HEADER]) || '').trim().toLowerCase();
  const sent = header.match(/^(app|web)(?:\/([\w.+-]{1,30}))?(?:\s*\(([a-z]{1,20})\))?/);
  if (sent) {
    const platform = sent[3] && PLATFORMS.includes(sent[3]) ? sent[3] : (sent[1] === 'web' ? 'web' : 'other');
    return { type: sent[1], version: clean(sent[2], 30), platform };
  }
  const agent = String((req.headers && req.headers['user-agent']) || '');
  // Older app builds: Dio on Android or iOS, before the header was added
  if (/^Dart\//.test(agent)) return { type: 'app', version: '', platform: 'other' };
  if (/Mozilla\//.test(agent)) return { type: 'web', version: '', platform: 'web' };
  return { type: 'unknown', version: '', platform: 'other' };
};

/** Express middleware: sets req.client for everything after it */
const clientInfo = (req, res, next) => {
  req.client = readClient(req);
  next();
};

/**
 * Remember that a signed-in user used this client (users.seen.app / users.seen.web), at most hourly
 * or when the app version changes. Never throws and never waits on the database.
 */
const noteSeen = (user, client) => {
  if (!user || !client || !['app', 'web'].includes(client.type)) return;
  const last = user.seen && user.seen[client.type];
  const fresh = last && last.at && Date.now() - new Date(last.at).getTime() < SEEN_EVERY_MS;
  if (fresh && (client.type !== 'app' || !client.version || last.version === client.version)) return;
  const seen = { at: new Date(), platform: client.platform, ...(client.version ? { version: client.version } : {}) };
  User.updateOne({ _id: user._id }, { $set: { [`seen.${client.type}`]: { ...(last && last.version ? { version: last.version } : {}), ...seen } } })
    .catch(err => console.warn('[CLIENT SEEN WARNING]', err.message));
};

/** The client to save on a record (a booking, a log entry): { type, version, platform } */
const clientOf = req => (req && req.client) || { type: 'unknown', version: '', platform: 'other' };

module.exports = { HEADER, TYPES, PLATFORMS, readClient, clientInfo, noteSeen, clientOf };
