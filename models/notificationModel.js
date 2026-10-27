const mongoose = require('mongoose');

// One in-app notification for one traveler. The mobile app lists these and marks them read.
const KINDS = [
  // From vendors and tours
  'vendor_message', 'announcement', 'event_cancelled', 'event_changed', 'tour_message',
  // About the traveler's own bookings
  'booking_requested', 'booking_confirmed', 'booking_cancelled', 'booking_completed', 'trip_reminder', 'points_earned', 'referral_reward',
  // From other travelers
  'post_reaction', 'post_comment', 'comment_reply', 'comment_reaction', 'post_share', 'new_follower',
  // From Plezar
  'post_hidden'
];
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency' },
    kind: {
      type: String,
      enum: KINDS,
      required: true
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, trim: true, maxlength: 3000, default: '' },
    event: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    announcement: { type: mongoose.Schema.ObjectId, ref: 'Announcement' },
    broadcast: { type: mongoose.Schema.ObjectId, ref: 'Broadcast' },
    // Social activity: who did it, and on what
    actor: { type: mongoose.Schema.ObjectId, ref: 'User' },
    post: { type: mongoose.Schema.ObjectId, ref: 'Post' },
    comment: { type: mongoose.Schema.ObjectId, ref: 'Comment' },
    // A reply from an agency to the traveler's question (tour_message)
    conversation: { type: mongoose.Schema.ObjectId, ref: 'Conversation' },
    // The booking an update is about
    booking: { type: mongoose.Schema.ObjectId, ref: 'Booking' },
    readAt: Date
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
// Old notifications clear themselves after 180 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

notificationSchema.index({ actor: 1, kind: 1, post: 1, comment: 1 });

// Automatically dispatch push notification via Firebase Cloud Messaging
notificationSchema.post('save', function (doc) {
  try {
    const { sendPushNotification } = require('../utils/pushNotification'); // eslint-disable-line global-require
    sendPushNotification({
      userIds: doc.user,
      title: doc.title,
      body: doc.body,
      data: {
        notificationId: String(doc._id),
        kind: doc.kind || '',
        eventId: doc.event ? String(doc.event) : '',
        bookingId: doc.booking ? String(doc.booking) : '',
        postId: doc.post ? String(doc.post) : '',
        conversationId: doc.conversation ? String(doc.conversation) : '',
        route: doc.event ? '/event-details' : (doc.conversation ? '/conversations' : '/notifications')
      }
    }).catch(err => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[FCM Push Notification]:', err.message);
      }
    });
  } catch (_) {
    // Graceful no-op
  }
});

const Notification = mongoose.model('Notification', notificationSchema);
Notification.KINDS = KINDS;
module.exports = Notification;
