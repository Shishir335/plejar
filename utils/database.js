// Which mode the server runs in, and which database it may connect to.
//
// Mode: NODE_ENV set by the shell or the host (npm scripts, Render's environment settings) wins.
// If it isn't set, Render counts as production and anywhere else as development, so a plain
// `node server.js` on a laptop never reaches live data. NODE_ENV inside config.env is ignored.
//
// In development the server only connects to a database whose name ends in dev, test or staging
// (plezar_dev), or to a MongoDB running on this machine. Anything else stops the server.

const DEV_NAME = /(dev|test|staging)$/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;

const resolveMode = ({ processEnv, argv = [], onRender = false }) => {
  const env = (processEnv || '').trim().toLowerCase();
  if (env === 'production' || env === 'prod') return 'production';
  if (env === 'development' || env === 'dev') return 'development';
  if (argv.includes('dev') || argv.includes('development')) return 'development';
  return onRender ? 'production' : 'development';
};

// { hosts: ['cluster0.x.mongodb.net'], name: 'plezar_dev' } from a MongoDB connection string
const parseUri = uri => {
  const m = String(uri || '').match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]*)\/?([^?]*)/i);
  if (!m) return { hosts: [], name: '' };
  return { hosts: m[1].split(',').filter(Boolean), name: decodeURIComponent(m[2] || '') };
};

const isLocal = hosts => hosts.length > 0 && hosts.every(h => LOCAL_HOST.test(h));
const isDevName = name => DEV_NAME.test(name || '');

// Why development may not use this database, or null when it may
const devRefusal = uri => {
  const { hosts, name } = parseUri(uri);
  if (isLocal(hosts)) return null;
  if (isDevName(name)) return null;
  return name
    ? `"${name}" isn't a development database (its name must end in dev, test or staging, e.g. plezar_dev)`
    : 'the connection string names no database, so MongoDB would use "test" on that cluster';
};

const describe = uri => {
  const { hosts, name } = parseUri(uri);
  const where = isLocal(hosts) ? 'this machine' : hosts[0] || 'unknown host';
  return `${name || '(no database name)'} on ${where}`;
};

module.exports = { resolveMode, parseUri, isDevName, devRefusal, describe };
