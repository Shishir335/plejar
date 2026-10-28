const mongoose = require('mongoose');
const { Conversation, Message } = require('../models/conversationModel');
const Package = require('../models/packageModel');
const Agency = require('../models/agencyModel');
const User = require('../models/userModel');
const Notification = require('../models/notificationModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { hasRole } = require('../utils/roles');
const { pageParams, paged } = require('../utils/query');
const { userCard, snippet } = require('../utils/social');

// NO LONGER ROUTED: "Message Tour Guide" now goes into the chat (controllers/chatController.js), and old
// threads move over with scripts/migrate-conversations-to-chat.js. Kept until the old data is moved.
// (Was: a traveler asks an agency about a tour; the agency's team replies in the vendor panel.)

const validId = id => mongoose.isValidObjectId(id);
const PAGE = 30;

const restricted = (user, flag) => {
  const r = user.restrictions || {};
  return Boolean(r[flag]) && (!r.until || r.until > new Date());
};

const readText = b => {
  const text = String((b && b.text) || '').trim();
  if (!text) throw new AppError('Write a message.', 400);
  if (text.length > 2000) throw new AppError('Keep messages under 2000 characters.', 400);
  return text;
};

const messageView = (m, viewerSide) => ({
  _id: m._id,
  text: m.text,
  side: m.side,
  mine: m.side === viewerSide,
  sender: m.sender && m.sender.name ? { _id: m.sender._id, name: m.sender.name } : null,
  createdAt: m.createdAt
});

/** Messages, newest page first but returned oldest to newest; ?before=<messageId> loads older ones */
const loadMessages = async (conversationId, req, viewerSide) => {
  const filter = { conversation: conversationId };
  if (validId(req.query.before)) {
    const pivot = await Message.findById(req.query.before).select('createdAt').lean();
    if (pivot) filter.createdAt = { $lt: pivot.createdAt };
  }
  const rows = await Message.find(filter).sort({ createdAt: -1 }).limit(PAGE + 1).populate('sender', 'name').lean();
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE).reverse();
  return { messages: page.map(m => messageView(m, viewerSide)), olderBefore: more ? String(page[0]._id) : null };
};

const addMessage = async (conversation, sender, side, text) => {
  const message = await Message.create({ conversation: conversation._id, sender: sender._id, side, text });
  conversation.lastMessageAt = message.createdAt;
  conversation.lastMessage = snippet(text, 140);
  conversation.lastSenderSide = side;
  if (side === 'traveler') {
    conversation.agencyUnread += 1;
    conversation.status = 'open';
  } else conversation.travelerUnread += 1;
  await conversation.save();
  return message;
};

// ---------- Traveler (app) ----------

const travelerConversationView = c => ({
  _id: c._id,
  agency: c.agency && c.agency.name ? { _id: c.agency._id, name: c.agency.name, logo: c.agency.logo || '', verified: Boolean(c.agency.verified) } : null,
  tour: c.tour ? { _id: c.tour._id || c.tour, title: (c.tour && c.tour.title) || c.tourTitle, photo: (c.tour && c.tour.photos && c.tour.photos[0]) || '' } : null,
  lastMessage: c.lastMessage,
  lastMessageAt: c.lastMessageAt,
  lastFromMe: c.lastSenderSide === 'traveler',
  unread: c.travelerUnread,
  status: c.status
});

const assertCanMessage = user => {
  if (!hasRole(user, 'user')) throw new AppError('Messaging tour guides is for traveler accounts in the app.', 403);
  if (restricted(user, 'messaging')) throw new AppError('Messaging is switched off for your account. Contact Plejar support.', 403);
};

// POST /tours/:id/messages { text } — starts the thread for this tour, or adds to it
exports.messageAboutTour = catchAsync(async (req, res, next) => {
  assertCanMessage(req.user);
  const text = readText(req.body);
  const tour = validId(req.params.id) ? await Package.findOne({ _id: req.params.id, status: { $in: ['published', 'cancelled'] } }).select('title agency photos') : null;
  const agency = tour && await Agency.findOne({ _id: tour.agency, status: 'active' }).select('name logo verified');
  if (!tour || !agency) return next(new AppError('This tour is not available.', 404));

  const conversation = await Conversation.findOneAndUpdate(
    { traveler: req.user._id, agency: agency._id, tour: tour._id },
    { $setOnInsert: { traveler: req.user._id, agency: agency._id, tour: tour._id, tourTitle: tour.title } },
    { upsert: true, new: true }
  );
  const message = await addMessage(conversation, req.user, 'traveler', text);
  conversation.agency = agency;
  conversation.tour = tour;
  res.status(201).json({
    status: 'success',
    message: `Sent to ${agency.name}. You'll get a notification when they reply.`,
    data: { conversation: travelerConversationView(conversation), message: messageView({ ...message.toObject(), sender: req.user }, 'traveler') }
  });
});

// GET /conversations — the traveler's threads, latest first
exports.myConversations = catchAsync(async (req, res) => {
  const page = pageParams(req.query);
  const filter = { traveler: req.user._id };
  const [rows, total, unread] = await Promise.all([
    Conversation.find(filter).sort({ lastMessageAt: -1 }).skip(page.skip).limit(page.limit).populate('agency', 'name logo verified').populate('tour', 'title photos').lean(),
    Conversation.countDocuments(filter),
    Conversation.aggregate([{ $match: filter }, { $group: { _id: null, n: { $sum: '$travelerUnread' } } }])
  ]);
  res.status(200).json({ status: 'success', data: { conversations: rows.map(travelerConversationView), unread: unread[0] ? unread[0].n : 0, ...paged(total, page) } });
});

exports.myUnreadCount = catchAsync(async (req, res) => {
  const rows = await Conversation.aggregate([{ $match: { traveler: req.user._id } }, { $group: { _id: null, n: { $sum: '$travelerUnread' } } }]);
  res.status(200).json({ status: 'success', data: { unread: rows[0] ? rows[0].n : 0 } });
});

const ownConversation = async (req, next) => {
  const c = validId(req.params.id) ? await Conversation.findOne({ _id: req.params.id, traveler: req.user._id }).populate('agency', 'name logo verified').populate('tour', 'title photos') : null;
  if (!c) next(new AppError('This conversation is not available.', 404));
  return c;
};

// GET /conversations/:id?before= — messages; opening it marks them read
exports.myConversation = catchAsync(async (req, res, next) => {
  const c = await ownConversation(req, next);
  if (!c) return;
  const data = await loadMessages(c._id, req, 'traveler');
  if (c.travelerUnread) await Conversation.updateOne({ _id: c._id }, { travelerUnread: 0 });
  c.travelerUnread = 0;
  res.status(200).json({ status: 'success', data: { conversation: travelerConversationView(c), ...data } });
});

exports.replyAsTraveler = catchAsync(async (req, res, next) => {
  assertCanMessage(req.user);
  const text = readText(req.body);
  const c = await ownConversation(req, next);
  if (!c) return;
  if (!c.agency) return next(new AppError('This agency is no longer on Plejar.', 400));
  const message = await addMessage(c, req.user, 'traveler', text);
  res.status(201).json({ status: 'success', data: { message: messageView({ ...message.toObject(), sender: req.user }, 'traveler') } });
});

// ---------- Agency (vendor panel) ----------

const agencyConversationView = c => ({
  _id: c._id,
  traveler: c.traveler && c.traveler.name ? { ...userCard(c.traveler), email: c.traveler.email || null, phone: c.traveler.phone || null } : null,
  tour: c.tour ? { _id: c.tour._id || c.tour, title: (c.tour && c.tour.title) || c.tourTitle, startDate: (c.tour && c.tour.startDate) || null } : null,
  lastMessage: c.lastMessage,
  lastMessageAt: c.lastMessageAt,
  lastFromTraveler: c.lastSenderSide === 'traveler',
  unread: c.agencyUnread,
  status: c.status
});

const TRAVELER_FIELDS = 'name photo verification.status status role email phone';

// GET /agency/me/conversations?status=open|closed|unread&page
exports.agencyConversations = catchAsync(async (req, res) => {
  const filter = { agency: req.agency._id };
  if (req.query.status === 'unread') filter.agencyUnread = { $gt: 0 };
  else if (['open', 'closed'].includes(req.query.status)) filter.status = req.query.status;
  const page = pageParams(req.query);
  const [rows, total, unread] = await Promise.all([
    Conversation.find(filter).sort({ lastMessageAt: -1 }).skip(page.skip).limit(page.limit).populate('traveler', TRAVELER_FIELDS).populate('tour', 'title startDate').lean(),
    Conversation.countDocuments(filter),
    Conversation.aggregate([{ $match: { agency: req.agency._id } }, { $group: { _id: null, n: { $sum: '$agencyUnread' }, threads: { $sum: { $cond: [{ $gt: ['$agencyUnread', 0] }, 1, 0] } } } }])
  ]);
  res.status(200).json({
    status: 'success',
    data: { conversations: rows.map(agencyConversationView), unread: unread[0] ? unread[0].n : 0, unreadThreads: unread[0] ? unread[0].threads : 0, ...paged(total, page) }
  });
});

const agencyConversation = async (req, next) => {
  const c = validId(req.params.id) ? await Conversation.findOne({ _id: req.params.id, agency: req.agency._id }).populate('traveler', TRAVELER_FIELDS).populate('tour', 'title startDate') : null;
  if (!c) next(new AppError('No conversation found with that ID.', 404));
  return c;
};

exports.agencyConversationDetail = catchAsync(async (req, res, next) => {
  const c = await agencyConversation(req, next);
  if (!c) return;
  const data = await loadMessages(c._id, req, 'agency');
  if (c.agencyUnread) await Conversation.updateOne({ _id: c._id }, { agencyUnread: 0 });
  c.agencyUnread = 0;
  res.status(200).json({ status: 'success', data: { conversation: agencyConversationView(c), ...data } });
});

// POST /agency/me/conversations/:id/messages { text } — the traveler gets a notification
exports.replyAsAgency = catchAsync(async (req, res, next) => {
  const text = readText(req.body);
  const c = await agencyConversation(req, next);
  if (!c) return;
  if (!c.traveler || c.traveler.status !== 'active') return next(new AppError("This traveler's account isn't active, so they can't get messages.", 400));
  const message = await addMessage(c, req.user, 'agency', text);

  const recipient = await User.findById(c.traveler._id).select('settings');
  const wantsIt = !(recipient && recipient.settings && recipient.settings.notifications && recipient.settings.notifications.tours === false);
  if (wantsIt) {
    await Notification.create({
      user: c.traveler._id,
      kind: 'tour_message',
      title: `${req.agency.name} replied${c.tourTitle ? ` about ${c.tourTitle}` : ''}`.slice(0, 120),
      body: snippet(text, 300),
      agency: req.agency._id,
      event: c.tour ? c.tour._id : undefined,
      conversation: c._id
    }).catch(err => console.warn('[NOTIFY WARNING]', err.message));
  }
  res.status(201).json({ status: 'success', data: { message: messageView({ ...message.toObject(), sender: req.user }, 'agency') } });
});

// PATCH /agency/me/conversations/:id { status: open|closed }
exports.setConversationStatus = catchAsync(async (req, res, next) => {
  if (!['open', 'closed'].includes(req.body.status)) return next(new AppError('Choose open or closed.', 400));
  const c = await agencyConversation(req, next);
  if (!c) return;
  c.status = req.body.status;
  await c.save();
  res.status(200).json({ status: 'success', data: { conversation: agencyConversationView(c) } });
});
