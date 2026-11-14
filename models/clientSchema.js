const mongoose = require('mongoose');

/** Which Plejar client something came from (utils/client.js): the app (and which build) or the website */
const CLIENT = new mongoose.Schema(
  {
    type: { type: String, enum: ['app', 'web', 'unknown'], default: 'unknown' },
    version: { type: String, default: '', maxlength: 30 },
    platform: { type: String, enum: ['android', 'ios', 'web', 'other'], default: 'other' }
  },
  { _id: false }
);

module.exports = { CLIENT };
