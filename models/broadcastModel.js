const mongoose = require('mongoose');

// A notification a vendor sent to an audience (kept as the vendor's sent history)
const broadcastSchema = new mongoose.Schema(
  {
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', index: true, default: null },
    scope: { type: String, enum: ['agency', 'admin'], default: 'agency', index: true },
    audience: {
      type: String,
      enum: ['event', 'travelers', 'followers', 'all_users', 'users', 'vendors', 'all'],
      required: true
    },
    event: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    eventTitle: { type: String, default: '' },
    announcement: { type: mongoose.Schema.ObjectId, ref: 'Announcement' },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, trim: true, maxlength: 1000, default: '' },
    recipientCount: { type: Number, default: 0 },
    pushStats: {
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 }
    },
    sentBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    sentByName: { type: String, default: '' }
  },
  { timestamps: true }
);

broadcastSchema.index({ agency: 1, createdAt: -1 });
broadcastSchema.index({ scope: 1, createdAt: -1 });

module.exports = mongoose.model('Broadcast', broadcastSchema);
