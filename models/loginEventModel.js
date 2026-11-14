const mongoose = require('mongoose');
const { CLIENT } = require('./clientSchema');

const loginEventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.ObjectId, ref: 'User', index: true },
  email: { type: String, lowercase: true, trim: true, index: true },
  success: { type: Boolean, required: true },
  reason: { type: String, default: '' }, // why a sign-in failed, for example wrong_password
  method: { type: String, enum: ['password', 'google', 'invite', 'reset'], default: 'password' },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '', maxlength: 300 },
  client: { type: CLIENT, default: undefined }, // the app or the website
  createdAt: { type: Date, default: Date.now }
});

loginEventSchema.index({ createdAt: -1 });
loginEventSchema.index({ 'client.type': 1, createdAt: -1 });
// Keep six months of history, then let MongoDB remove old entries
loginEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

module.exports = mongoose.model('LoginEvent', loginEventSchema);
