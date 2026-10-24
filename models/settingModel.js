const mongoose = require('mongoose');

// Small key/value store for platform-wide settings such as the default commission rate
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed,
    updatedBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Setting', settingSchema);
