const ActivityLog = require('../models/activityLogModel');
const LoginEvent = require('../models/loginEventModel');
const { noteSeen } = require('./client');

const clientIp = req => (req && (req.ip || (req.headers && req.headers['x-forwarded-for']))) || '';

/**
 * Record something worth showing on a user's or vendor's activity page.
 * Never throws: a logging problem must not break the action itself.
 */
const logActivity = async (req, { action, summary, user, agency }) => {
  try {
    const actor = req && req.user;
    await ActivityLog.create({
      actor: actor ? actor._id : undefined,
      actorName: actor ? actor.name : '',
      actorRole: actor ? actor.role : '',
      user,
      agency,
      action,
      summary,
      ip: String(clientIp(req)).slice(0, 80),
      ...(req && req.client ? { client: req.client } : {})
    });
  } catch (err) {
    console.warn('[ACTIVITY LOG WARNING]', err.message);
  }
};

/**
 * Record a sign-in attempt (success or failure). Never throws.
 */
const recordLogin = async (req, { user, email, success, reason = '', method = 'password' }) => {
  try {
    await LoginEvent.create({
      user: user ? user._id : undefined,
      email: email || (user && user.email) || '',
      success,
      reason,
      method,
      ip: String(clientIp(req)).slice(0, 80),
      userAgent: String((req.headers && req.headers['user-agent']) || '').slice(0, 300),
      ...(req.client ? { client: req.client } : {})
    });
    if (success && user) noteSeen(user, req.client);
  } catch (err) {
    console.warn('[LOGIN EVENT WARNING]', err.message);
  }
};

module.exports = { logActivity, recordLogin };
