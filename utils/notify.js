const Booking = require('../models/bookingModel');
const Notification = require('../models/notificationModel');
const Broadcast = require('../models/broadcastModel');
const AppError = require('./appError');

// How many notifications a vendor can send in any 24 hours (system messages like cancellations don't count)
const BROADCASTS_PER_DAY = 10;

/**
 * The travelers a vendor can reach:
 *  - 'followers': everyone following this tour agency
 *  - 'all_users': all active travelers registered on the Plejar app
 *  - 'event': everyone registered for that event (cancelled registrations left out)
 *  - 'travelers': everyone who has ever booked with the vendor
 */
const audienceUsers = async (agencyId, audience, eventId) => {
  const User = require('../models/userModel'); // eslint-disable-line global-require
  const Follow = require('../models/followModel'); // eslint-disable-line global-require

  if (audience === 'followers') {
    return Follow.distinct('follower', { targetType: 'agency', target: agencyId });
  }

  if (audience === 'all_users' || audience === 'all') {
    return User.distinct('_id', {
      roles: 'user',
      status: 'active',
      isDeleted: { $ne: true }
    });
  }

  if (audience === 'event') {
    return Booking.distinct('user', {
      agency: agencyId,
      package: eventId,
      status: { $in: ['pending', 'confirmed', 'completed'] }
    });
  }

  return Booking.distinct('user', { agency: agencyId });
};

// Create notifications per traveler (skipping anyone who switched off tour updates in Settings)
const notifyUsers = async (userIds, fields) => {
  if (!userIds || !userIds.length) return { recipientsCount: 0, pushStats: { sent: 0, failed: 0, total: 0 } };
  const User = require('../models/userModel'); // eslint-disable-line global-require
  const optedOut = new Set(
    (await User.find({ _id: { $in: userIds }, 'settings.notifications.tours': false }).select('_id').lean()).map(u => String(u._id))
  );
  const recipients = userIds.filter(id => !optedOut.has(String(id)));
  if (!recipients.length) return { recipientsCount: 0, pushStats: { sent: 0, failed: 0, total: 0 } };

  // Batch insert notifications in chunks of 1000
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const chunk = recipients.slice(i, i + CHUNK_SIZE);
    await Notification.insertMany(chunk.map(user => ({ ...fields, user })), { ordered: false }).catch(() => {});
  }

  // Send Firebase Push Notifications to the recipients
  let pushStats = { sent: 0, failed: 0, total: 0 };
  try {
    const { sendPushNotification } = require('./pushNotification'); // eslint-disable-line global-require
    const res = await sendPushNotification({
      userIds: recipients,
      title: fields.title,
      body: fields.body,
      data: {
        kind: fields.kind || 'vendor_message',
        eventId: fields.event ? String(fields.event) : '',
        announcementId: fields.announcement ? String(fields.announcement) : '',
        route: fields.event ? '/event-details' : '/notifications'
      }
    });
    if (res) pushStats = res;
  } catch (_) {}

  return { recipientsCount: recipients.length, pushStats };
};

const broadcastsLeft = async agencyId => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const used = await Broadcast.countDocuments({ agency: agencyId, createdAt: { $gte: since } });
  return Math.max(BROADCASTS_PER_DAY - used, 0);
};

/**
 * Send a vendor's notification to an audience and keep it in their sent history.
 * Throws AppError when the daily limit is reached or nobody is in the audience.
 */
const sendBroadcast = async ({ agency, sender, audience, event, title, body, announcement, kind = 'vendor_message' }) => {
  if ((await broadcastsLeft(agency._id)) <= 0) {
    throw new AppError(`You can send ${BROADCASTS_PER_DAY} notifications in 24 hours. Try again later.`, 429);
  }
  const users = await audienceUsers(agency._id, audience, event && event._id);
  if (!users.length) {
    let emptyMsg = 'Nobody is in this audience yet.';
    if (audience === 'followers') emptyMsg = 'You do not have any followers yet. When travelers follow your agency, you can send them notifications.';
    else if (audience === 'all_users') emptyMsg = 'No active app travelers found to notify.';
    else if (audience === 'event') emptyMsg = 'Nobody is registered for this event yet, so there is no one to notify.';
    else if (audience === 'travelers') emptyMsg = 'No travelers have booked with you yet, so there is no one to notify.';
    throw new AppError(emptyMsg, 400);
  }

  const broadcast = await Broadcast.create({
    agency: agency._id,
    scope: 'agency',
    audience,
    event: event ? event._id : undefined,
    eventTitle: event ? event.title : '',
    announcement: announcement ? announcement._id : undefined,
    title,
    body,
    recipientCount: users.length,
    sentBy: sender._id,
    sentByName: sender.name
  });

  const { pushStats } = await notifyUsers(users, {
    agency: agency._id,
    kind,
    title,
    body,
    event: event ? event._id : undefined,
    announcement: announcement ? announcement._id : undefined,
    broadcast: broadcast._id
  });

  if (pushStats && (pushStats.sent || pushStats.failed)) {
    broadcast.pushStats = pushStats;
    await broadcast.save();
  }

  return broadcast;
};

module.exports = { BROADCASTS_PER_DAY, audienceUsers, notifyUsers, broadcastsLeft, sendBroadcast };

