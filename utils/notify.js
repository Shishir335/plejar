const Booking = require('../models/bookingModel');
const Notification = require('../models/notificationModel');
const Broadcast = require('../models/broadcastModel');
const AppError = require('./appError');

// How many notifications a vendor can send in any 24 hours (system messages like cancellations don't count)
const BROADCASTS_PER_DAY = 10;

/**
 * The travelers a vendor can reach:
 *  - 'event': everyone registered for that event (cancelled registrations left out)
 *  - 'travelers': everyone who has ever registered with the vendor (including trips that were later cancelled)
 */
const audienceUsers = (agencyId, audience, eventId) => {
  const match = audience === 'event'
    ? { agency: agencyId, package: eventId, status: { $in: ['pending', 'confirmed', 'completed'] } }
    : { agency: agencyId };
  return Booking.distinct('user', match);
};

// Create one notification per traveler (skipping anyone who switched off tour updates in Settings)
const notifyUsers = async (userIds, fields) => {
  if (!userIds.length) return 0;
  const User = require('../models/userModel'); // eslint-disable-line global-require
  const optedOut = new Set((await User.find({ _id: { $in: userIds }, 'settings.notifications.tours': false }).select('_id').lean()).map(u => String(u._id)));
  const recipients = userIds.filter(id => !optedOut.has(String(id)));
  if (!recipients.length) return 0;
  await Notification.insertMany(recipients.map(user => ({ ...fields, user })), { ordered: false });
  return recipients.length;
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
    throw new AppError(audience === 'event' ? 'Nobody is registered for this event yet, so there is no one to notify.' : 'No travelers have booked with you yet, so there is no one to notify.', 400);
  }

  const broadcast = await Broadcast.create({
    agency: agency._id,
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
  await notifyUsers(users, {
    agency: agency._id,
    kind,
    title,
    body,
    event: event ? event._id : undefined,
    announcement: announcement ? announcement._id : undefined,
    broadcast: broadcast._id
  });
  return broadcast;
};

module.exports = { BROADCASTS_PER_DAY, audienceUsers, notifyUsers, broadcastsLeft, sendBroadcast };
