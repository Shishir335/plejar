const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const User = require('../models/userModel');
const Agency = require('../models/agencyModel');
const { hasRole } = require('./roles');
const { agencyBlockedReason } = require('./agencyStanding');

/**
 * Live updates over Socket.IO (path /socket.io, same port as the API).
 * Sending, history and reading stay on the REST API; the socket only pushes what changed.
 * Every connection signs in with the same JWT as the API and says which inbox it is for (auth.side).
 * One person can be a traveler, a vendor and staff, so a connection only ever joins one room:
 *   user:<id>      the app, the default                 — the person's own chats, on all their devices
 *   agency:<id>    the vendor panel (side: 'agency')    — their tours' groups, guide and agency chats
 *   support        an admin panel (side: 'support')     — Customer Support chats
 * When sockets aren't running (tests, scripts) every emit here quietly does nothing.
 */

let io = null;
// Handlers for events the clients send (chat:typing), added by the chat controller
const clientHandlers = [];

const tokenFrom = socket => {
  const auth = socket.handshake.auth || {};
  if (auth.token) return String(auth.token).replace(/^Bearer\s+/i, '');
  const header = socket.handshake.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  // The vendor and admin panels also sign in with the jwt cookie
  const cookie = (socket.handshake.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('jwt='));
  const value = cookie ? decodeURIComponent(cookie.slice(4)) : '';
  return value && value !== 'loggedout' ? value : null;
};

// The same checks as authController.protect, for a socket
const signIn = async socket => {
  const token = tokenFrom(socket);
  if (!token) throw new Error('Sign in first.');
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id);
  if (!user || (user.changedPasswordAfter && user.changedPasswordAfter(decoded.iat))) throw new Error('Sign in again.');
  // Lazy: authController loads models that load this file's users
  const { blockedReason } = require('../controllers/authController'); // eslint-disable-line global-require
  const blocked = await blockedReason(user);
  if (blocked) throw new Error(blocked);
  return user;
};

// The room for the inbox this connection asked for, if the person may hear it (same rules as the routes)
const roomFor = async (user, side) => {
  if (side === 'agency') {
    if (!hasRole(user, 'agent') || !user.agency) throw new Error('This account is not on a vendor team.');
    const blocked = await agencyBlockedReason(await Agency.findById(user.agency));
    if (blocked) throw new Error(blocked);
    return `agency:${user.agency}`;
  }
  if (side === 'support') {
    if (!hasRole(user, 'admin', 'manager', 'dev')) throw new Error('This account is not Plejar staff.');
    return 'support';
  }
  return `user:${user._id}`;
};

/** Start Socket.IO on the HTTP server (server.js) */
const init = httpServer => {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    // Mobile networks drop quietly; notice within about 45 seconds
    pingInterval: 20000,
    pingTimeout: 25000
  });

  io.use(async (socket, next) => {
    try {
      socket.user = await signIn(socket);
      const { side } = socket.handshake.auth || {};
      socket.side = side === 'agency' || side === 'support' ? side : 'traveler';
      socket.inbox = await roomFor(socket.user, socket.side);
      next();
    } catch (err) {
      next(new Error(err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError' ? 'Sign in again.' : err.message));
    }
  });

  io.on('connection', socket => {
    const { user } = socket;
    socket.join(socket.inbox);
    socket.emit('ready', { userId: String(user._id), side: socket.side, agency: socket.side === 'agency' ? String(user.agency) : null, serverTime: new Date() });
    clientHandlers.forEach(([event, handler]) => socket.on(event, (payload, ack) => {
      Promise.resolve(handler(socket, payload || {}))
        .then(result => typeof ack === 'function' && ack({ ok: true, ...(result || {}) }))
        .catch(err => typeof ack === 'function' && ack({ ok: false, message: err.message }));
    }));
  });
  return io;
};

/** Let the clients send this event; handler(socket, payload) may return data for the ack */
const onClientEvent = (event, handler) => clientHandlers.push([event, handler]);

const emitTo = (room, event, payload) => {
  if (io) io.to(room).emit(event, payload);
};
const emitToUser = (userId, event, payload) => emitTo(`user:${userId}`, event, payload);
const emitToAgency = (agencyId, event, payload) => emitTo(`agency:${agencyId}`, event, payload);
const emitToSupport = (event, payload) => emitTo('support', event, payload);
// Skip work that only matters when somebody is connected
const isRunning = () => Boolean(io);

/** Is anyone connected in this room right now? (e.g. a traveler on any device) */
const isOnline = async userId => Boolean(io) && (await io.in(`user:${userId}`).fetchSockets()).length > 0;

module.exports = { init, onClientEvent, emitToUser, emitToAgency, emitToSupport, isRunning, isOnline };
