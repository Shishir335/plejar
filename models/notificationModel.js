const mongoose = require('mongoose');

// One in-app notification for one traveler. The mobile app lists these and marks them read.
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency' },
    kind: {
      type: String,
      enum: ['vendor_message', 'announcement', 'event_cancelled', 'event_changed'],
      required: true
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, trim: true, maxlength: 3000, default: '' },
    event: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    announcement: { type: mongoose.Schema.ObjectId, ref: 'Announcement' },
    broadcast: { type: mongoose.Schema.ObjectId, ref: 'Broadcast' },
    readAt: Date
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
// Old notifications clear themselves after 180 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);
