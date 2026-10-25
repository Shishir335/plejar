const Package = require('../models/packageModel');
const Agency = require('../models/agencyModel');
const Announcement = require('../models/announcementModel');
const Notification = require('../models/notificationModel');
const Destination = require('../models/destinationModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { escapeRegex, pageParams, paged, validId } = require('../utils/query');
const { registrationStats, withStats, registrationClosedReason } = require('../utils/events');
const { userCard, snippet } = require('../utils/social');

// Endpoints the mobile app uses: browsing tour events and announcements, and a traveler's notifications

const AGENCY_CARD = 'name logo verified regions';

const activeAgencyIds = async ids => {
  const filter = { status: 'active' };
  if (ids) filter._id = { $in: ids };
  return (await Agency.find(filter).select('_id')).map(a => a._id);
};

const publicEvent = (event, stats) => {
  const e = withStats(event, stats);
  const closed = registrationClosedReason(e);
  return {
    _id: e._id,
    title: e.title,
    destination: e.destination,
    description: e.description,
    included: e.included,
    photos: e.photos,
    startDate: e.startDate,
    endDate: e.endDate,
    durationDays: e.durationDays,
    durationNights: e.durationNights,
    registrationDeadline: e.registrationDeadline,
    meetingPoint: e.meetingPoint,
    pricePerPerson: e.priceFrom,
    seats: e.seats,
    seatsLeft: e.seatsLeft,
    registered: e.stats.registrations,
    registrationOpen: !closed && (e.seatsLeft === null || e.seatsLeft > 0),
    registrationClosedReason: closed || (e.seatsLeft === 0 ? 'This tour event is full.' : null),
    // The declared plan
    departureTime: e.departureTime,
    returnInfo: e.returnInfo,
    childPrice: e.childPrice,
    advanceAmount: e.advanceAmount,
    excluded: e.excluded,
    whatToBring: e.whatToBring,
    difficulty: e.difficulty,
    cancellationPolicy: e.cancellationPolicy,
    transport: e.transport,
    accommodation: e.accommodation,
    itinerary: (e.itinerary || []).map(d => ({
      day: d.day,
      date: e.startDate ? new Date(new Date(e.startDate).getTime() + (d.day - 1) * 86400000).toISOString().slice(0, 10) : null,
      title: d.title,
      stay: d.stay,
      meals: d.meals,
      stops: (d.stops || []).map(st => ({
        time: st.time,
        place: st.place,
        kind: st.kind,
        note: st.note,
        destination: st.destinationRef && st.destinationRef.slug && st.destinationRef.status === 'published' ? { _id: st.destinationRef._id, name: st.destinationRef.name, slug: st.destinationRef.slug } : null
      }))
    })),
    agency: e.agency,
    place: e.destinationRef && e.destinationRef.status === 'published' ? { _id: e.destinationRef._id, name: e.destinationRef.name, slug: e.destinationRef.slug, type: e.destinationRef.type } : null
  };
};

// Upcoming published tour events, soonest first. Filters: agency, destination, from, to.
exports.listEvents = catchAsync(async (req, res, next) => {
  const q = req.query;
  if (q.agency && !validId(q.agency)) return next(new AppError('Unknown agency.', 400));
  const filter = {
    status: 'published',
    startDate: { $gte: new Date() },
    agency: { $in: await activeAgencyIds(q.agency ? [q.agency] : null) }
  };
  if (q.destination) filter.destination = { $regex: escapeRegex(String(q.destination).trim()), $options: 'i' };
  // Events at a destination or anywhere inside it (a region includes its cities and attractions)
  if (q.destinationId) {
    if (!validId(q.destinationId)) return next(new AppError('Unknown destination.', 400));
    const inside = await Destination.find({ ancestors: q.destinationId }).select('_id').lean();
    filter.destinationRef = { $in: [q.destinationId, ...inside.map(d => d._id)] };
  }
  if (q.from && !Number.isNaN(Date.parse(q.from))) filter.startDate.$gte = new Date(Math.max(Date.parse(q.from), Date.now()));
  if (q.to && !Number.isNaN(Date.parse(q.to))) filter.startDate.$lte = new Date(q.to);

  const page = pageParams(q);
  const [events, total] = await Promise.all([
    Package.find(filter).sort({ startDate: 1 }).skip(page.skip).limit(page.limit).populate('agency', AGENCY_CARD).populate('destinationRef', 'name slug type status').populate('itinerary.stops.destinationRef', 'name slug status'),
    Package.countDocuments(filter)
  ]);
  const stats = await registrationStats(events.map(e => e._id));
  res.status(200).json({ status: 'success', data: { events: events.map(e => publicEvent(e, stats)), ...paged(total, page) } });
});

exports.getEvent = catchAsync(async (req, res, next) => {
  const event = validId(req.params.id)
    ? await Package.findOne({ _id: req.params.id, status: { $in: ['published', 'cancelled'] } }).populate('agency', `${AGENCY_CARD} status`).populate('destinationRef', 'name slug type status').populate('itinerary.stops.destinationRef', 'name slug status')
    : null;
  if (!event || !event.agency || event.agency.status !== 'active') return next(new AppError('That tour event is not available.', 404));
  const stats = await registrationStats([event._id]);
  const data = publicEvent(event, stats);
  data.agency = { _id: event.agency._id, name: event.agency.name, logo: event.agency.logo, verified: event.agency.verified, regions: event.agency.regions };
  if (event.status === 'cancelled') Object.assign(data, { cancelled: true, cancelReason: event.cancelReason, registrationOpen: false, registrationClosedReason: 'This tour event was cancelled.' });
  res.status(200).json({ status: 'success', data: { event: data } });
});

// Published announcements, pinned first. Filter by agency for an agency's page.
exports.listAnnouncements = catchAsync(async (req, res, next) => {
  if (req.query.agency && !validId(req.query.agency)) return next(new AppError('Unknown agency.', 400));
  const filter = { status: 'published', agency: { $in: await activeAgencyIds(req.query.agency ? [req.query.agency] : null) } };
  const page = pageParams(req.query);
  const sort = req.query.agency ? { pinned: -1, publishedAt: -1 } : { publishedAt: -1 };
  const [announcements, total] = await Promise.all([
    Announcement.find(filter).sort(sort).skip(page.skip).limit(page.limit)
      .select('agency title body event pinned publishedAt')
      .populate('agency', 'name logo verified')
      .populate('event', 'title startDate status')
      .lean(),
    Announcement.countDocuments(filter)
  ]);
  res.status(200).json({ status: 'success', data: { announcements, ...paged(total, page) } });
});

// ---------- The signed-in traveler's notifications ----------

// Notifications tab: newest first, with who did it and a peek at the post it's about
const NOTE_GROUPS = {
  social: ['post_reaction', 'post_comment', 'comment_reply', 'comment_reaction', 'post_share', 'new_follower'],
  tours: ['vendor_message', 'announcement', 'event_cancelled', 'event_changed'],
  plezar: ['post_hidden']
};

exports.myNotifications = catchAsync(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.unread === 'true') filter.readAt = null;
  if (NOTE_GROUPS[req.query.group]) filter.kind = { $in: NOTE_GROUPS[req.query.group] };
  const page = pageParams(req.query);
  const [rows, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit)
      .select('-user -broadcast')
      .populate('agency', 'name logo verified')
      .populate('actor', 'name photo verification.status')
      .populate('post', 'text media status')
      .populate('event', 'title startDate')
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, readAt: null })
  ]);
  const notifications = rows.map(n => ({
    ...n,
    group: Object.keys(NOTE_GROUPS).find(g => NOTE_GROUPS[g].includes(n.kind)) || 'other',
    actor: n.actor ? userCard(n.actor) : null,
    post: n.post && n.post.status === 'active' ? { _id: n.post._id, text: snippet(n.post.text, 100), thumbnail: (n.post.media || []).find(m => m.type === 'image') ? n.post.media.find(m => m.type === 'image').url : '' } : null
  }));
  res.status(200).json({ status: 'success', data: { notifications, unread, ...paged(total, page) } });
});

// The number on the Notifications tab
exports.unreadCount = catchAsync(async (req, res) => {
  const unread = await Notification.countDocuments({ user: req.user._id, readAt: null });
  res.status(200).json({ status: 'success', data: { unread } });
});

exports.deleteNotification = catchAsync(async (req, res, next) => {
  const gone = validId(req.params.id) ? await Notification.findOneAndDelete({ _id: req.params.id, user: req.user._id }) : null;
  if (!gone) return next(new AppError('No notification found with that ID.', 404));
  res.status(204).json({ status: 'success', data: null });
});

exports.markRead = catchAsync(async (req, res, next) => {
  const note = validId(req.params.id)
    ? await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { $set: { readAt: new Date() } }, { new: true }).select('-user -broadcast')
    : null;
  if (!note) return next(new AppError('No notification found with that ID.', 404));
  res.status(200).json({ status: 'success', data: { notification: note } });
});

exports.markAllRead = catchAsync(async (req, res) => {
  const result = await Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  res.status(200).json({ status: 'success', data: { marked: result.modifiedCount } });
});
