const Announcement = require('../models/announcementModel');
const Broadcast = require('../models/broadcastModel');
const Package = require('../models/packageModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { validId } = require('../utils/query');
const { BROADCASTS_PER_DAY, audienceUsers, broadcastsLeft, sendBroadcast } = require('../utils/notify');

// Everything here runs after agencyController.requireAgent, so req.agency is the signed-in vendor's agency

const findOwnEvent = async (req, id) => {
  if (!id) return null;
  const event = validId(id) ? await Package.findOne({ _id: id, agency: req.agency._id }).select('title startDate status') : null;
  if (!event) throw new AppError('No tour event found with that ID in your agency.', 404);
  return event;
};

// ---------- Announcements ----------

exports.listAnnouncements = catchAsync(async (req, res) => {
  const announcements = await Announcement.find({ agency: req.agency._id })
    .sort({ pinned: -1, updatedAt: -1 })
    .populate('event', 'title startDate')
    .lean();
  res.status(200).json({ status: 'success', data: { announcements } });
});

const findOwnAnnouncement = async (req, next) => {
  const item = validId(req.params.id) ? await Announcement.findOne({ _id: req.params.id, agency: req.agency._id }) : null;
  if (!item) next(new AppError('No announcement found with that ID in your agency.', 404));
  return item;
};

// Apply the editable fields; returns true when the announcement just became published
const applyAnnouncement = async (req, item) => {
  const b = req.body;
  if (b.title !== undefined) item.title = String(b.title);
  if (b.body !== undefined) item.body = String(b.body);
  if (b.pinned !== undefined) item.pinned = b.pinned === true || b.pinned === 'true';
  if (b.event !== undefined) item.event = b.event ? (await findOwnEvent(req, b.event))._id : undefined;

  let justPublished = false;
  if (b.status !== undefined) {
    if (!['draft', 'published'].includes(b.status)) throw new AppError('Status must be draft or published.', 400);
    justPublished = b.status === 'published' && item.status !== 'published';
    item.status = b.status;
    if (justPublished) item.publishedAt = new Date();
  }
  item.updatedBy = req.user._id;
  return justPublished;
};

// Who to notify about a published announcement (once per announcement), checked before anything is saved
const notifyPlan = async (req, item) => {
  const audience = req.body.notify;
  if (!audience || audience === 'none' || item.status !== 'published' || item.notifiedAt) return null;
  if (!['travelers', 'event'].includes(audience)) throw new AppError('Choose who to notify: your travelers, or the people registered for the linked event.', 400);
  if (audience === 'event' && !item.event) throw new AppError('Link the announcement to a tour event to notify the people registered for it.', 400);

  if ((await broadcastsLeft(req.agency._id)) <= 0) {
    throw new AppError(`You can send ${BROADCASTS_PER_DAY} notifications in 24 hours. Publish without notifying, or try again later.`, 429);
  }
  const users = await audienceUsers(req.agency._id, audience, item.event);
  if (!users.length) {
    throw new AppError(audience === 'event' ? 'Nobody is registered for the linked event yet. Publish without notifying.' : 'No travelers have booked with you yet. Publish without notifying.', 400);
  }
  return { audience, event: audience === 'event' ? await Package.findById(item.event).select('title') : null };
};

const notifyAbout = async (req, item, plan) => {
  if (!plan) return null;
  const broadcast = await sendBroadcast({
    agency: req.agency,
    sender: req.user,
    audience: plan.audience,
    event: plan.event,
    announcement: item,
    kind: 'announcement',
    title: item.title.slice(0, 120),
    body: item.body.slice(0, 1000)
  });
  item.notifiedAt = new Date();
  await item.save();
  return broadcast;
};

const announcementResponse = async (res, status, item, broadcast, verb) => {
  await item.populate('event', 'title startDate');
  const notified = broadcast ? ` ${broadcast.recipientCount} traveler${broadcast.recipientCount === 1 ? ' was' : 's were'} notified.` : '';
  res.status(status).json({ status: 'success', message: `Announcement ${verb}.${notified}`, data: { announcement: item, broadcast } });
};

exports.createAnnouncement = catchAsync(async (req, res) => {
  const item = new Announcement({ agency: req.agency._id, createdBy: req.user._id });
  await applyAnnouncement(req, item);
  await item.validate();
  const plan = await notifyPlan(req, item);
  await item.save();
  await logActivity(req, { action: 'announcement.created', summary: `${item.status === 'published' ? 'Published' : 'Drafted'} announcement "${item.title}"`, agency: req.agency._id });
  const broadcast = await notifyAbout(req, item, plan);
  await announcementResponse(res, 201, item, broadcast, item.status === 'published' ? 'published' : 'saved as a draft');
});

exports.updateAnnouncement = catchAsync(async (req, res, next) => {
  const item = await findOwnAnnouncement(req, next);
  if (!item) return;
  const justPublished = await applyAnnouncement(req, item);
  await item.validate();
  const plan = await notifyPlan(req, item);
  await item.save();
  await logActivity(req, { action: 'announcement.updated', summary: `${justPublished ? 'Published' : 'Edited'} announcement "${item.title}"`, agency: req.agency._id });
  const broadcast = await notifyAbout(req, item, plan);
  await announcementResponse(res, 200, item, broadcast, justPublished ? 'published' : 'saved');
});

exports.deleteAnnouncement = catchAsync(async (req, res, next) => {
  const item = await findOwnAnnouncement(req, next);
  if (!item) return;
  await item.deleteOne();
  await logActivity(req, { action: 'announcement.deleted', summary: `Deleted announcement "${item.title}"`, agency: req.agency._id });
  res.status(204).json({ status: 'success', data: null });
});

// ---------- Notifications to travelers ----------

// Who can be reached, so the vendor sees the numbers before sending
exports.getAudience = catchAsync(async (req, res) => {
  const [followers, allUsers, travelers, events, left] = await Promise.all([
    audienceUsers(req.agency._id, 'followers'),
    audienceUsers(req.agency._id, 'all_users'),
    audienceUsers(req.agency._id, 'travelers'),
    Package.find({ agency: req.agency._id, startDate: { $exists: true } }).sort({ startDate: -1 }).select('title startDate status').lean(),
    broadcastsLeft(req.agency._id)
  ]);
  const counts = await Promise.all(events.map(e => audienceUsers(req.agency._id, 'event', e._id)));
  res.status(200).json({
    status: 'success',
    data: {
      followers: followers.length,
      allUsers: allUsers.length,
      travelers: travelers.length,
      events: events.map((e, i) => ({ ...e, registered: counts[i].length })),
      limit: BROADCASTS_PER_DAY,
      left
    }
  });
});

exports.listBroadcasts = catchAsync(async (req, res) => {
  const broadcasts = await Broadcast.find({ agency: req.agency._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.status(200).json({ status: 'success', data: { broadcasts, left: await broadcastsLeft(req.agency._id), limit: BROADCASTS_PER_DAY } });
});

exports.sendBroadcast = catchAsync(async (req, res, next) => {
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const { audience } = req.body;
  if (!['followers', 'all_users', 'travelers', 'event'].includes(audience)) {
    return next(new AppError('Choose who gets the notification (followers, all users, event, or travelers).', 400));
  }
  if (!title) return next(new AppError('Write a short title.', 400));
  if (title.length > 120) return next(new AppError('Keep the title under 120 characters.', 400));
  if (body.length > 1000) return next(new AppError('Keep the message under 1000 characters.', 400));
  if (audience === 'event' && !req.body.eventId) return next(new AppError('Choose the tour event.', 400));

  const event = audience === 'event' ? await findOwnEvent(req, req.body.eventId) : null;
  const broadcast = await sendBroadcast({ agency: req.agency, sender: req.user, audience, event, title, body });

  let audLabel = 'all travelers';
  if (audience === 'followers') audLabel = 'agency followers';
  else if (audience === 'all_users') audLabel = 'all app users';
  else if (event) audLabel = `registered for ${event.title}`;

  await logActivity(req, {
    action: 'broadcast.sent',
    summary: `Sent "${title}" to ${broadcast.recipientCount} recipient${broadcast.recipientCount === 1 ? '' : 's'} (${audLabel})`,
    agency: req.agency._id
  });

  res.status(201).json({
    status: 'success',
    message: `Sent to ${broadcast.recipientCount} recipient${broadcast.recipientCount === 1 ? '' : 's'}.`,
    data: { broadcast, left: await broadcastsLeft(req.agency._id) }
  });
});
