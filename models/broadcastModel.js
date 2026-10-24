const mongoose = require('mongoose');

// A notification a vendor sent to an audience (kept as the vendor's sent history)
const broadcastSchema = new mongoose.Schema(
  {
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', required: true, index: true },
    audience: { type: String, enum: ['event', 'travelers'], required: true },
    event: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    eventTitle: { type: String, default: '' },
    announcement: { type: mongoose.Schema.ObjectId, ref: 'Announcement' },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, trim: true, maxlength: 1000, default: '' },
    recipientCount: { type: Number, default: 0 },
    sentBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    sentByName: { type: String, default: '' }
  },
  { timestamps: true }
);

broadcastSchema.index({ agency: 1, createdAt: -1 });

module.exports = mongoose.model('Broadcast', broadcastSchema);
