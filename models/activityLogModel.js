const mongoose = require('mongoose');
const { CLIENT } = require('./clientSchema');

// A readable trail of who did what, shown on user and vendor activity pages
const activityLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.ObjectId, ref: 'User' },
  actorName: { type: String, default: '' },
  actorRole: { type: String, default: '' },
  user: { type: mongoose.Schema.ObjectId, ref: 'User', index: true }, // the traveler this is about, if any
  agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', index: true }, // the vendor this is about, if any
  action: { type: String, required: true }, // machine name, for example user.suspended
  summary: { type: String, required: true, maxlength: 400 },
  ip: { type: String, default: '' },
  client: { type: CLIENT, default: undefined }, // the app or the website
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);
