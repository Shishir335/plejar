const mongoose = require('mongoose');
const { ChatRoom, ChatMessage } = require('../models/chatModel');
const User = require('../models/userModel');
const Agency = require('../models/agencyModel');
const Package = require('../models/packageModel');
const Block = require('../models/blockModel');
const Booking = require('../models/bookingModel');
const Notification = require('../models/notificationModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { hasRole } = require('../utils/roles');
const { photoURL, snippet } = require('../utils/social');
const { escapeRegex } = require('../utils/query');
const { saveChatFile, hasChatFile, sendChatFile, removeChatFiles } = require('../utils/chatFiles');
const realtime = require('../utils/realtime');
const { IN_GROUP, ensureTourGroup, joinTourGroup, findOrCreateRoom, guideRoom, agencyRoom, roomForTourQuestion, guideSenderName, loadGuide } = require('../utils/chats');

/**
 * Chat ("Messages"): tour group chats and direct chats. Everything is saved through these routes;
 * Socket.IO pushes the changes live. While the socket is down, clients poll instead:
 * GET /chats/unread for the badge, GET /chats/:id/messages?after=<last id> inside a chat, and GET /chats.
 * Three kinds of people take part, each through their own routes:
 *   travelers  /api/v1/chats                   (members, one by one)
 *   agencies   /api/v1/agency/me/chats         (the agency side of tour groups and guide chats)
 *   support    /api/v1/admin/support-chats     (Plejar staff answering Customer Support)
 * One account can be on several sides, even of the same chat (a vendor messaging their own agency
 * from the app), so "mine" always means this side sent it, never only this account did.
 */

const validId = id => mongoose.isValidObjectId(id);
const PAGE = 30;
const POLL_SECONDS = 5;
const SUPPORT_NAME = 'Plejar Support';

const restricted = (user, flag) => {
  const r = user.restrictions || {};
  return Boolean(r[flag]) && (!r.until || r.until > new Date());
};

const activeMember = (room, userId) => room.members.find(m => String(m.user) === String(userId) && !m.leftAt);
const anyMember = (room, userId) => room.members.find(m => String(m.user) === String(userId));

// Did this viewer send it, on the side they're looking from? `m` is a message or a room's lastMessage.
const sentBy = (m, viewer) => (viewer.side === 'traveler'
  ? m.side === 'traveler' && String(m.sender) === String(viewer.user._id)
  : m.side === viewer.side);

// Who is looking: { side: 'traveler' | 'agency' | 'support', user, agency? }
const viewerOf = req => {
  if (req.chatSide === 'agency') return { side: 'agency', user: req.user, agency: req.agency };
  if (req.chatSide === 'support') return { side: 'support', user: req.user };
  return { side: 'traveler', user: req.user };
};

const unreadFor = (room, viewer) => {
  if (viewer.side === 'agency') return room.agencyUnread || 0;
  if (viewer.side === 'support') return room.supportUnread || 0;
  const m = anyMember(room, viewer.user._id);
  return m ? m.unread : 0;
};

const KIND_LABEL = { tour_group: 'Group Chat', traveler: 'Direct Message', guide: 'Direct Message', agency: 'Direct Message', support: 'Direct Message' };
// Chats with an agency that the agency marked done: a new message opens them again
const REOPENS = ['guide', 'agency'];

// Everyone in the chat. A tour group: the organizer (agency), its guide, then the travelers.
// A direct chat: the two sides (a guide chat's agency answers as the guide; support as Plejar Support).
const participantsOf = (room, { agency, guide, users }) => {
  const list = [];
  if (['tour_group', 'agency'].includes(room.kind) && agency) list.push({ type: 'agency', _id: agency._id, name: agency.name, photo: agency.logo || '', role: room.kind === 'tour_group' ? 'Organizer' : 'Tour agency', verified: Boolean(agency.verified) });
  if (guide) list.push({ type: 'guide', _id: guide._id, name: guide.name, photo: guide.photo || '', role: guide.title || 'Tour Guide', agency: agency ? agency.name : '' });
  if (room.kind === 'support') list.push({ type: 'support', _id: null, name: SUPPORT_NAME, photo: '', role: 'Customer Support' });
  room.members.filter(m => !m.leftAt).forEach(m => {
    const u = users.get(String(m.user));
    if (u) list.push({ type: 'traveler', _id: u._id, name: u.name, photo: photoURL(u.photo), role: 'Traveler' });
  });
  return list;
};

/** A room as the viewer's list shows it; `ctx` has the people and places it refers to */
const roomView = (room, viewer, ctx) => {
  const users = ctx.users || new Map();
  const agency = room.agency ? (ctx.agencies || new Map()).get(String(room.agency)) : null;
  const guide = room.guide ? (ctx.guides || new Map()).get(String(room.guide)) : null;
  let { title } = room;
  let photo = room.photo || '';
  let subtitle = KIND_LABEL[room.kind];
  let other = null;
  if (room.kind === 'traveler') {
    const otherMember = room.members.find(m => String(m.user) !== String(viewer.user._id));
    const u = otherMember && users.get(String(otherMember.user));
    title = u ? u.name : 'Plejar traveler';
    photo = u ? photoURL(u.photo) : '';
    other = u ? { _id: u._id, name: u.name, photo: photoURL(u.photo) } : null;
  } else if (room.kind === 'guide') {
    if (viewer.side === 'traveler') {
      title = guide ? `${guide.name} (Tour Guide)` : room.title;
      photo = guide ? guide.photo || '' : photo;
      subtitle = agency ? `Direct Message · ${agency.name}` : subtitle;
    } else {
      const u = users.get(String((room.members[0] || {}).user));
      title = u ? u.name : 'Traveler';
      photo = u ? photoURL(u.photo) : '';
      subtitle = guide ? `Message to ${guide.name}` : subtitle;
    }
  } else if (room.kind === 'agency') {
    if (viewer.side === 'traveler') {
      title = agency ? agency.name : room.title;
      photo = agency ? agency.logo || '' : photo;
    } else {
      const u = users.get(String((room.members[0] || {}).user));
      title = u ? u.name : 'Traveler';
      photo = u ? photoURL(u.photo) : '';
      subtitle = 'Message to your agency';
    }
  } else if (room.kind === 'support') {
    if (viewer.side === 'traveler') title = 'Customer Support';
    else {
      const u = users.get(String((room.members[0] || {}).user));
      title = u ? u.name : 'Traveler';
      photo = u ? photoURL(u.photo) : '';
      subtitle = u ? u.email || u.phone || '' : '';
    }
  } else if (room.kind === 'tour_group') {
    subtitle = 'Group Chat';
  }
  const me = viewer.side === 'traveler' ? anyMember(room, viewer.user._id) : null;
  const travelers = room.members.filter(m => !m.leftAt).length;
  return {
    _id: room._id,
    type: room.type,
    kind: room.kind,
    title,
    subtitle,
    photo,
    other,
    tour: room.tour || null,
    participantCount: room.kind === 'tour_group' ? travelers + 1 + (room.guide ? 1 : 0) : 2,
    lastMessage: room.lastMessage && room.lastMessage.text ? {
      text: room.lastMessage.text,
      type: room.lastMessage.type,
      senderName: room.lastMessage.senderName,
      mine: sentBy(room.lastMessage, viewer)
    } : null,
    lastMessageAt: room.lastMessageAt,
    unread: unreadFor(room, viewer),
    muted: Boolean(me && me.muted),
    canSend: (room.status === 'active' || REOPENS.includes(room.kind)) && (viewer.side !== 'traveler' || Boolean(me && !me.leftAt)),
    status: room.status
  };
};

// Load the people, agencies and guides a set of rooms mention, in three queries
const contextFor = async rooms => {
  const userIds = new Set();
  const agencyIds = new Set();
  const guideIds = new Set();
  rooms.forEach(r => {
    r.members.forEach(m => userIds.add(String(m.user)));
    if (r.agency) agencyIds.add(String(r.agency));
    if (r.guide) guideIds.add(String(r.guide));
  });
  const Guide = mongoose.model('Guide');
  const [users, agencies, guides] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } }).select('name photo email phone').setOptions({ includeInactive: true }).lean(),
    Agency.find({ _id: { $in: [...agencyIds] } }).select('name logo verified').lean(),
    Guide.find({ _id: { $in: [...guideIds] } }).select('name photo title').lean()
  ]);
  return {
    users: new Map(users.map(u => [String(u._id), u])),
    agencies: new Map(agencies.map(a => [String(a._id), a])),
    guides: new Map(guides.map(g => [String(g._id), g]))
  };
};

// What each kind of viewer may see
const roomFilterFor = viewer => {
  if (viewer.side === 'agency') return { agency: viewer.agency._id, kind: { $in: ['tour_group', 'guide', 'agency'] } };
  if (viewer.side === 'support') return { kind: 'support' };
  return { 'members.user': viewer.user._id };
};

/** The room, if this viewer may open it (404 otherwise, so ids can't be probed) */
const findRoom = async (req, viewer) => {
  const room = validId(req.params.id) ? await ChatRoom.findOne({ _id: req.params.id, ...roomFilterFor(viewer) }) : null;
  if (!room) throw new AppError('No chat found with that ID.', 404);
  return room;
};

const messageView = (m, viewer, room, ctx) => {
  const mine = sentBy(m, viewer);
  const base =`/api/v1/${{ traveler: 'chats', agency: 'agency/me/chats', support: 'admin/support-chats' }[viewer.side]}/${room._id}/attachments`;
  const u = m.sender && ctx.users.get(String(m.sender));
  // In a direct chat, my message is "seen" once the other side has read past it
  let seen = null;
  if (mine && room.type === 'direct') {
    let readAt;
    if (viewer.side === 'traveler') {
      if (room.kind === 'traveler') readAt = (room.members.find(x => String(x.user) !== String(viewer.user._id)) || {}).lastReadAt;
      else readAt = room.kind === 'support' ? room.supportLastReadAt : room.agencyLastReadAt;
    } else readAt = (room.members[0] || {}).lastReadAt;
    seen = Boolean(readAt && readAt >= m.createdAt);
  }
  return {
    _id: m._id,
    type: m.type,
    side: m.side,
    mine,
    sender: m.side === 'system' ? null : {
      _id: m.sender || null,
      name: m.senderName || (u && u.name) || '',
      photo: m.senderPhoto || (u ? photoURL(u.photo) : '')
    },
    text: m.deletedAt ? 'This message was deleted.' : m.text,
    deleted: Boolean(m.deletedAt),
    attachments: m.deletedAt ? [] : (m.attachments || []).map(a => ({
      _id: a._id, kind: a.kind, name: a.name, mimeType: a.mimeType, size: a.size, width: a.width, height: a.height, url: `${base}/${a._id}`
    })),
    seen,
    // The tour a question is about, shown as a small card above the message
    about: m.tour ? { _id: m.tour, title: ((ctx.tours && ctx.tours.get(String(m.tour))) || {}).title || '' } : null,
    createdAt: m.createdAt
  };
};

const addTours = async (ctx, messages) => {
  const ids = [...new Set(messages.map(m => m.tour).filter(Boolean).map(String))];
  ctx.tours = new Map((ids.length ? await Package.find({ _id: { $in: ids } }).select('title').lean() : []).map(t => [String(t._id), t]));
  return ctx;
};

/**
 * Messages, oldest to newest. Newest page by default; ?before=<id> for older ones (scrolling up);
 * ?after=<id> for anything new since the last one the app has (polling).
 */
const loadMessages = async (room, req, viewer) => {
  const filter = { room: room._id };
  const after = validId(req.query.after) ? await ChatMessage.findOne({ _id: req.query.after, room: room._id }).select('createdAt').lean() : null;
  const before = validId(req.query.before) ? await ChatMessage.findOne({ _id: req.query.before, room: room._id }).select('createdAt').lean() : null;
  let rows;
  let hasOlder = false;
  if (after) {
    filter.$or = [{ createdAt: { $gt: after.createdAt } }, { createdAt: after.createdAt, _id: { $gt: after._id } }];
    rows = await ChatMessage.find(filter).sort({ createdAt: 1, _id: 1 }).limit(200).lean();
  } else {
    if (before) filter.$or = [{ createdAt: { $lt: before.createdAt } }, { createdAt: before.createdAt, _id: { $lt: before._id } }];
    rows = await ChatMessage.find(filter).sort({ createdAt: -1, _id: -1 }).limit(PAGE + 1).lean();
    hasOlder = rows.length > PAGE;
    rows = rows.slice(0, PAGE).reverse();
  }
  const ctx = await contextFor([room]);
  const extra = rows.map(m => m.sender).filter(id => id && !ctx.users.has(String(id)));
  if (extra.length) (await User.find({ _id: { $in: extra } }).select('name photo').lean()).forEach(u => ctx.users.set(String(u._id), u));
  await addTours(ctx, rows);
  return {
    messages: rows.map(m => messageView(m, viewer, room, ctx)),
    hasOlder,
    oldestId: rows.length ? rows[0]._id : null,
    latestId: rows.length ? rows[rows.length - 1]._id : (req.query.after || null),
    pollAfterSeconds: POLL_SECONDS
  };
};

const markRead = async (room, viewer) => {
  const now = new Date();
  if (viewer.side === 'agency') await ChatRoom.updateOne({ _id: room._id }, { agencyUnread: 0, agencyLastReadAt: now });
  else if (viewer.side === 'support') await ChatRoom.updateOne({ _id: room._id }, { supportUnread: 0, supportLastReadAt: now });
  else await ChatRoom.updateOne({ _id: room._id, 'members.user': viewer.user._id }, { $set: { 'members.$.unread': 0, 'members.$.lastReadAt': now } });
};

// Travelers blocked either way can't message each other
const blockedBetween = (a, b) => Block.exists({ $or: [{ blocker: a, blocked: b }, { blocker: b, blocked: a }] });

const unreadTotal = async viewer => {
  if (viewer.side === 'agency') {
    const r = await ChatRoom.aggregate([{ $match: roomFilterFor(viewer) }, { $group: { _id: null, n: { $sum: '$agencyUnread' }, chats: { $sum: { $cond: [{ $gt: ['$agencyUnread', 0] }, 1, 0] } } } }]);
    return { total: r[0] ? r[0].n : 0, chats: r[0] ? r[0].chats : 0 };
  }
  if (viewer.side === 'support') {
    const r = await ChatRoom.aggregate([{ $match: { kind: 'support' } }, { $group: { _id: null, n: { $sum: '$supportUnread' }, chats: { $sum: { $cond: [{ $gt: ['$supportUnread', 0] }, 1, 0] } } } }]);
    return { total: r[0] ? r[0].n : 0, chats: r[0] ? r[0].chats : 0 };
  }
  const r = await ChatRoom.aggregate([
    { $match: { 'members.user': viewer.user._id } },
    { $unwind: '$members' },
    { $match: { 'members.user': viewer.user._id, 'members.muted': { $ne: true } } },
    { $group: { _id: null, n: { $sum: '$members.unread' }, chats: { $sum: { $cond: [{ $gt: ['$members.unread', 0] }, 1, 0] } } } }
  ]);
  return { total: r[0] ? r[0].n : 0, chats: r[0] ? r[0].chats : 0 };
};

// ---------- Live updates (Socket.IO, utils/realtime.js) ----------
// The REST calls above save everything; these push the change to whoever should see it, each
// person getting the version made for them ("mine", titles, attachment links differ by side).

// Everyone who sees a room, as the viewer each one is
const audienceOf = room => {
  const list = room.members.filter(m => !m.leftAt).map(m => ({ side: 'traveler', user: { _id: m.user }, room: `user:${m.user}`, userId: m.user }));
  if (room.agency) list.push({ side: 'agency', user: { _id: null }, agency: { _id: room.agency }, room: `agency:${room.agency}` });
  if (room.kind === 'support') list.push({ side: 'support', user: { _id: null }, room: 'support' });
  return list;
};

const emitTo = (viewer, event, payload) => {
  if (viewer.side === 'traveler') realtime.emitToUser(viewer.userId, event, payload);
  else if (viewer.side === 'agency') realtime.emitToAgency(viewer.agency._id, event, payload);
  else realtime.emitToSupport(event, payload);
};

// Run after the response is sent; a failed push never breaks a request
const later = (label, fn) => {
  if (!realtime.isRunning()) return;
  setImmediate(() => fn().catch(err => console.warn(`[REALTIME WARNING] ${label}:`, err.message)));
};

/**
 * chat:message { chatId, message, chat } and chat:unread { total, chats } to everyone in the room
 * (the sender's other devices too, with mine: true).
 */
const broadcastMessage = (roomId, messageId) => later('message', async () => {
  const [room, message] = await Promise.all([ChatRoom.findById(roomId), ChatMessage.findById(messageId).lean()]);
  if (!room || !message) return;
  const ctx = await addTours(await contextFor([room]), [message]);
  if (message.sender && !ctx.users.has(String(message.sender))) {
    const sender = await User.findById(message.sender).select('name photo').lean();
    if (sender) ctx.users.set(String(sender._id), sender);
  }
  await Promise.all(audienceOf(room).map(async viewer => {
    emitTo(viewer, 'chat:message', { chatId: String(room._id), message: messageView(message, viewer, room, ctx), chat: roomView(room, viewer, ctx) });
    emitTo(viewer, 'chat:unread', await unreadTotal(viewer));
  }));
});

/** chat:updated { chat } — the room changed (closed, reopened, someone joined or left, muted) */
const broadcastRoom = (roomId, { only } = {}) => later('room', async () => {
  const room = await ChatRoom.findById(roomId);
  if (!room) return;
  const ctx = await contextFor([room]);
  // A member who just left still hears that the chat is now read-only for them
  const left = room.members.filter(m => m.leftAt).map(m => ({ side: 'traveler', user: { _id: m.user }, userId: m.user }));
  [...audienceOf(room), ...left]
    .filter(v => !only || (v.userId && String(v.userId) === String(only)))
    .forEach(viewer => emitTo(viewer, 'chat:updated', { chat: roomView(room, viewer, ctx) }));
});

/** chat:read { chatId, side, userId, readAt } to the others ("Seen"), chat:unread to the reader */
const broadcastRead = (room, reader) => later('read', async () => {
  const readAt = new Date();
  const payload = { chatId: String(room._id), side: reader.side, userId: reader.side === 'traveler' ? String(reader.user._id) : null, readAt };
  const self = reader.side === 'traveler' ? { ...reader, userId: reader.user._id } : reader;
  audienceOf(room).filter(v => (reader.side === 'traveler' ? String(v.userId) !== String(reader.user._id) : v.side !== reader.side))
    .forEach(viewer => emitTo(viewer, 'chat:read', payload));
  emitTo(self, 'chat:unread', await unreadTotal(reader));
});

/** chat:deleted { chatId, messageId } */
const broadcastDeleted = (room, messageId) => later('deleted', async () => {
  audienceOf(room).forEach(viewer => emitTo(viewer, 'chat:deleted', { chatId: String(room._id), messageId: String(messageId) }));
});

/**
 * Clients send chat:typing { chatId, typing } while someone types; the others get
 * chat:typing { chatId, name, typing }. Never saved. At most one every second per chat.
 */
realtime.onClientEvent('chat:typing', async (socket, { chatId, typing }) => {
  if (!validId(chatId)) throw new Error('No chat with that ID.');
  const now = Date.now();
  socket.data.typingAt = socket.data.typingAt || {};
  if (typing !== false && now - (socket.data.typingAt[chatId] || 0) < 1000) return { throttled: true };
  socket.data.typingAt[chatId] = now;
  const room = await ChatRoom.findById(chatId);
  if (!room || room.status !== 'active') throw new Error('No chat with that ID.');
  const { user } = socket;
  let from = null;
  // The inbox this connection signed in for decides who is typing
  if (socket.side === 'traveler' && activeMember(room, user._id)) from = { side: 'traveler', name: user.name, userId: user._id };
  else if (socket.side === 'agency' && room.agency && String(user.agency) === String(room.agency)) from = { side: 'agency', name: (await Agency.findById(room.agency).select('name').lean() || {}).name || 'Agency' };
  else if (socket.side === 'support' && room.kind === 'support') from = { side: 'support', name: SUPPORT_NAME };
  if (!from) throw new Error('No chat with that ID.');
  audienceOf(room)
    .filter(v => (from.side === 'traveler' ? String(v.userId) !== String(from.userId) : v.side !== from.side))
    .forEach(viewer => emitTo(viewer, 'chat:typing', { chatId: String(room._id), name: from.name, side: from.side, typing: typing !== false }));
  return {};
});

exports.broadcastMessage = broadcastMessage;
exports.broadcastRoom = broadcastRoom;

/**
 * A notification for travelers who get a new direct message, the first one since they last read
 * the chat (so a burst of messages makes one notification). Replies from agencies and guides are
 * "tour_message" like before; everything else is "chat_message". Group chats don't notify.
 */
const notifyDirect = async (room, viewer, message, preview) => {
  if (room.type !== 'direct') return;
  try {
    const isSender = m => viewer.side === 'traveler' && String(m.user) === String(viewer.user._id);
    const waiting = room.members.filter(m => !m.leftAt && !m.muted && !isSender(m) && !m.unread);
    if (!waiting.length) return;
    const users = await User.find({ _id: { $in: waiting.map(m => m.user) }, status: 'active' }).select('settings').lean();
    const fromAgency = viewer.side === 'agency';
    let title = `New message from ${message.senderName}`;
    if (fromAgency || viewer.side === 'support') title = `${message.senderName} replied`;
    await Promise.all(users
      .filter(u => !(fromAgency && u.settings && u.settings.notifications && u.settings.notifications.tours === false))
      .map(u => Notification.create({
        user: u._id,
        kind: fromAgency ? 'tour_message' : 'chat_message',
        title: title.slice(0, 120),
        body: preview,
        agency: room.agency || undefined,
        event: message.tour || undefined,
        chat: room._id
      })));
  } catch (err) {
    console.warn('[NOTIFY WARNING]', err.message);
  }
};

/** Save a message and update the room: counts for everyone else, the preview line */
const sendMessage = async (room, viewer, req, { tour } = {}) => {
  let reopened = false;
  if (room.status !== 'active') {
    // Chats with an agency open again when either side writes; groups and support stay closed
    if (!REOPENS.includes(room.kind) || viewer.side === 'support') throw new AppError('This chat is closed. You can read it but not send new messages.', 400);
    room.status = 'active';
    await ChatRoom.updateOne({ _id: room._id }, { status: 'active' });
    reopened = true;
  }
  if (viewer.side === 'traveler') {
    if (!activeMember(room, viewer.user._id)) throw new AppError("You're no longer in this chat.", 403);
    if (restricted(viewer.user, 'messaging')) throw new AppError('Messaging is switched off for your account. Contact Plejar support.', 403);
    if (room.kind === 'traveler') {
      const other = room.members.find(m => String(m.user) !== String(viewer.user._id));
      if (other && await blockedBetween(viewer.user._id, other.user)) throw new AppError("You can't message this person.", 403);
    }
  }
  const text = String(req.body.text || '').trim();
  const files = req.files || [];
  if (!text && !files.length) throw new AppError('Write a message or add a photo or file.', 400);
  if (text.length > 4000) throw new AppError('Keep messages under 4000 characters.', 400);

  // Who it shows as
  let senderName = viewer.user.name;
  let senderPhoto = viewer.side === 'traveler' ? photoURL(viewer.user.photo) : '';
  let asGuide;
  if (viewer.side === 'support') senderName = SUPPORT_NAME;
  if (viewer.side === 'agency') {
    senderName = viewer.agency.name;
    senderPhoto = viewer.agency.logo || '';
    // Guide chats answer as the guide; in a tour group the agency can choose to post as one of its guides
    const guideId = req.body.asGuide || (room.kind === 'guide' ? room.guide : null);
    if (guideId) {
      const guide = validId(guideId) ? await loadGuide(guideId) : null;
      if (!guide || String(guide.agency) !== String(viewer.agency._id)) throw new AppError('Choose one of your guides.', 400);
      senderName = guideSenderName(guide);
      senderPhoto = guide.photo || '';
      asGuide = guide._id;
    }
  }

  const saved = await Promise.allSettled(files.map(file => saveChatFile(file, room._id)));
  const attachments = saved.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (attachments.length < files.length) {
    await removeChatFiles(attachments);
    throw new AppError("That photo or file couldn't be saved. Try another one.", 400);
  }
  let type = 'text';
  if (attachments.length) type = attachments.every(a => a.kind === 'image') ? 'image' : 'file';
  const message = await ChatMessage.create({
    room: room._id, sender: viewer.user._id, side: viewer.side, senderName, senderPhoto, asGuide, type, text, attachments, tour
  });

  // Everyone else gets an unread message: the other travelers, the agency side, support
  const one = attachments[0] && attachments[0].kind === 'image' ? 'a photo' : 'a file';
  const preview = text ? snippet(text, 140) : `Sent ${attachments.length === 1 ? one : `${attachments.length} attachments`}`;
  const inc = { messageCount: 1, 'members.$[other].unread': 1 };
  if (room.agency && viewer.side !== 'agency') inc.agencyUnread = 1;
  if (room.kind === 'support' && viewer.side !== 'support') inc.supportUnread = 1;
  const set = {
    lastMessage: { text: preview, type, senderName, sender: viewer.user._id, side: viewer.side },
    lastMessageAt: message.createdAt
  };
  // Sending counts as having read the chat up to your own message
  if (viewer.side === 'agency') Object.assign(set, { agencyUnread: 0, agencyLastReadAt: message.createdAt });
  if (viewer.side === 'support') Object.assign(set, { supportUnread: 0, supportLastReadAt: message.createdAt });
  if (viewer.side === 'traveler') Object.assign(set, { 'members.$[me].unread': 0, 'members.$[me].lastReadAt': message.createdAt });
  // Only a traveler leaves themselves out: a vendor's reply is unread for every traveler in the chat,
  // even when the vendor's own account is one of them
  const arrayFilters = [viewer.side === 'traveler' ? { 'other.user': { $ne: viewer.user._id }, 'other.leftAt': null } : { 'other.leftAt': null }];
  if (viewer.side === 'traveler') arrayFilters.push({ 'me.user': viewer.user._id });
  await ChatRoom.updateOne({ _id: room._id }, { $inc: inc, $set: set }, { arrayFilters });
  await notifyDirect(room, viewer, message, preview);
  broadcastMessage(room._id, message._id);
  if (reopened) broadcastRoom(room._id);
  return message;
};

// ---------- Traveler (app) ----------

const PAGE_LIST = 30;

/**
 * GET /chats?q=&kind=group|direct&since=<ISO time>&page — "Messages": every chat the traveler is in,
 * newest first, with unread counts. ?since returns only chats that changed after that time.
 */
const listRooms = async (req, viewer) => {
  const and = [roomFilterFor(viewer)];
  if (req.query.kind === 'group' || req.query.kind === 'direct') and.push({ type: req.query.kind });
  if (ChatRoom.KINDS.includes(req.query.kind)) and.push({ kind: req.query.kind });
  if (req.query.since && !Number.isNaN(new Date(req.query.since).getTime())) and.push({ updatedAt: { $gt: new Date(req.query.since) } });
  if (req.query.status === 'active' || req.query.status === 'closed') and.push({ status: req.query.status });
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ title: rx }, { searchText: rx }, { 'lastMessage.text': rx }] });
  }
  if (req.query.unread === 'true') {
    if (viewer.side === 'agency') and.push({ agencyUnread: { $gt: 0 } });
    else if (viewer.side === 'support') and.push({ supportUnread: { $gt: 0 } });
    else and.push({ members: { $elemMatch: { user: viewer.user._id, unread: { $gt: 0 } } } });
  }
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const filter = { $and: and };
  const [rooms, total] = await Promise.all([
    ChatRoom.find(filter).sort({ lastMessageAt: -1 }).skip((page - 1) * PAGE_LIST).limit(PAGE_LIST),
    ChatRoom.countDocuments(filter)
  ]);
  const ctx = await contextFor(rooms);
  return { chats: rooms.map(r => roomView(r, viewer, ctx)), total, page, pages: Math.max(Math.ceil(total / PAGE_LIST), 1), serverTime: new Date() };
};


const assertTraveler = user => {
  if (!hasRole(user, 'user')) throw new AppError('Chat is for traveler accounts in the Plejar app.', 403);
};

exports.useSide = side => (req, res, next) => {
  req.chatSide = side;
  next();
};

exports.list = catchAsync(async (req, res) => {
  const viewer = viewerOf(req);
  const [data, unread] = await Promise.all([listRooms(req, viewer), unreadTotal(viewer)]);
  res.status(200).json({ status: 'success', data: { ...data, unread, pollAfterSeconds: 15 } });
});

// GET /chats/unread — the badge: unread messages and how many chats have them (muted chats left out)
exports.unread = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: await unreadTotal(viewerOf(req)) });
});

const openRoomResponse = async (res, room, viewer, status = 200) => {
  const ctx = await contextFor([room]);
  res.status(status).json({ status: 'success', data: { chat: roomView(room, viewer, ctx) } });
};

// GET /chats/:id — the chat's header
exports.getRoom = catchAsync(async (req, res) => {
  const viewer = viewerOf(req);
  await openRoomResponse(res, await findRoom(req, viewer), viewer);
});

// GET /chats/:id/participants — "5 Participants"
exports.participants = catchAsync(async (req, res) => {
  const viewer = viewerOf(req);
  const room = await findRoom(req, viewer);
  const ctx = await contextFor([room]);
  const agency = room.agency ? ctx.agencies.get(String(room.agency)) : null;
  const guide = room.guide ? ctx.guides.get(String(room.guide)) : null;
  const participants = participantsOf(room, { agency, guide, users: ctx.users });
  res.status(200).json({ status: 'success', data: { count: participants.length, participants } });
});

/** GET /chats/:id/messages?before=|after=&markRead=false — messages; reading them marks the chat read */
exports.messages = catchAsync(async (req, res) => {
  const viewer = viewerOf(req);
  const room = await findRoom(req, viewer);
  const data = await loadMessages(room, req, viewer);
  if (req.query.markRead !== 'false' && !req.query.before) {
    await markRead(room, viewer);
    // Tell the others ("Seen") only when something was actually unread
    if (unreadFor(room, viewer) > 0) broadcastRead(room, viewer);
  }
  res.status(200).json({ status: 'success', data });
});

// The answer to a sent message (and the chat, when it was just opened)
const sentResponse = async (res, room, viewer, message, extra = {}) => {
  const fresh = await ChatRoom.findById(room._id);
  const ctx = await addTours(await contextFor([fresh]), [message]);
  ctx.users.set(String(viewer.user._id), viewer.user);
  res.status(201).json({ status: 'success', ...extra.top, data: { ...(extra.chat ? { chat: roomView(fresh, viewer, ctx) } : {}), message: messageView(message.toObject(), viewer, fresh, ctx) } });
};

/** POST /chats/:id/messages — JSON { text }, or multipart: text and up to 4 "files" (photos or PDFs) */
exports.send = catchAsync(async (req, res) => {
  const viewer = viewerOf(req);
  const room = await findRoom(req, viewer);
  // A traveler can say which of the agency's tours they're asking about
  let tour;
  if (req.body.tour && room.agency && ['guide', 'agency'].includes(room.kind)) {
    tour = validId(req.body.tour) ? await Package.findOne({ _id: req.body.tour, agency: room.agency }).select('_id') : null;
    if (!tour) throw new AppError("Choose one of this agency's tours.", 400);
  }
  const message = await sendMessage(room, viewer, req, { tour: tour && tour._id });
  await sentResponse(res, room, viewer, message);
});


// POST /chats/:id/read
exports.read = catchAsync(async (req, res) => {
  const viewer = viewerOf(req);
  const room = await findRoom(req, viewer);
  await markRead(room, viewer);
  broadcastRead(room, viewer);
  res.status(200).json({ status: 'success', data: { unread: await unreadTotal(viewer) } });
});

// DELETE /chats/:id/messages/:messageId — delete your own message (it shows as "This message was deleted")
exports.deleteMessage = catchAsync(async (req, res, next) => {
  const viewer = viewerOf(req);
  const room = await findRoom(req, viewer);
  const mine = viewer.side === 'traveler' ? { sender: viewer.user._id, side: 'traveler' } : { side: viewer.side };
  const message = validId(req.params.messageId) ? await ChatMessage.findOne({ _id: req.params.messageId, room: room._id, ...mine, deletedAt: null }) : null;
  if (!message) return next(new AppError('No message of yours with that ID.', 404));
  await removeChatFiles(message.attachments);
  message.deletedAt = new Date();
  message.text = '';
  message.attachments = [];
  await message.save();
  if (room.lastMessageAt && room.lastMessageAt.getTime() === message.createdAt.getTime()) {
    await ChatRoom.updateOne({ _id: room._id }, { 'lastMessage.text': 'This message was deleted.' });
  }
  broadcastDeleted(room, message._id);
  res.status(200).json({ status: 'success', message: 'Message deleted.' });
});

// GET /chats/:id/attachments/:attachmentId — the photo or file itself (only for people in the chat)
exports.attachment = catchAsync(async (req, res, next) => {
  const viewer = viewerOf(req);
  const room = await findRoom(req, viewer);
  const message = validId(req.params.attachmentId) ? await ChatMessage.findOne({ room: room._id, 'attachments._id': req.params.attachmentId, deletedAt: null }).lean() : null;
  const att = message && message.attachments.find(a => String(a._id) === String(req.params.attachmentId));
  if (!att || !hasChatFile(att.file)) return next(new AppError('That file is no longer available.', 404));
  res.setHeader('Content-Type', att.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', `${att.kind === 'image' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(att.name || 'file')}"`);
  await sendChatFile(att.file, res).catch(err => {
    console.error('[CHAT] File read failed:', err.message);
    if (res.headersSent) res.destroy();
    else next(new AppError('That file is no longer available.', 404));
  });
});

// PATCH /chats/:id { muted } — a traveler's own setting for the chat
exports.updateMine = catchAsync(async (req, res, next) => {
  const viewer = viewerOf(req);
  const room = await findRoom(req, viewer);
  if (typeof req.body.muted !== 'boolean') return next(new AppError('Send muted: true or false.', 400));
  await ChatRoom.updateOne({ _id: room._id, 'members.user': viewer.user._id }, { $set: { 'members.$.muted': req.body.muted } });
  broadcastRoom(room._id, { only: viewer.user._id });
  await openRoomResponse(res, await ChatRoom.findById(room._id), viewer);
});

/** POST /chats/direct { userId } — chat with another traveler (opens the one you already have) */
exports.startDirect = catchAsync(async (req, res, next) => {
  assertTraveler(req.user);
  const otherId = String(req.body.userId || '');
  if (!validId(otherId) || otherId === String(req.user._id)) return next(new AppError('Choose someone to message.', 400));
  const other = await User.findOne({ _id: otherId, status: 'active' }).select('name firstName lastName photo role roles');
  if (!other || !hasRole(other, 'user')) return next(new AppError('This traveler is not available.', 404));
  if (await blockedBetween(req.user._id, other._id)) return next(new AppError("You can't message this person.", 403));
  const pair = [String(req.user._id), String(other._id)].sort();
  const [room, created] = await findOrCreateRoom(`traveler:${pair[0]}:${pair[1]}`, {
    kind: 'traveler',
    searchText: `${req.user.name} ${other.name}`,
    members: [{ user: req.user._id, lastReadAt: new Date() }, { user: other._id }]
  });
  await openRoomResponse(res, room, viewerOf(req), created ? 201 : 200);
});

/** POST /chats/guides/:guideId — "Message" a tour guide; the guide's agency answers */
exports.startGuide = catchAsync(async (req, res, next) => {
  assertTraveler(req.user);
  const guide = validId(req.params.guideId) ? await loadGuide(req.params.guideId) : null;
  const agency = guide && guide.active !== false ? await Agency.findOne({ _id: guide.agency, status: 'active' }).select('name logo') : null;
  if (!agency) return next(new AppError('This guide is not available right now.', 404));
  const [room, created] = await guideRoom(guide, agency, req.user);
  await openRoomResponse(res, room, viewerOf(req), created ? 201 : 200);
});

/** POST /chats/agencies/:agencyId — message a tour agency (from its profile in the Agents tab) */
exports.startAgency = catchAsync(async (req, res, next) => {
  assertTraveler(req.user);
  const agency = validId(req.params.agencyId) ? await Agency.findOne({ _id: req.params.agencyId, status: 'active' }).select('name logo') : null;
  if (!agency) return next(new AppError('This agency is not available.', 404));
  const [room, created] = await agencyRoom(agency, req.user);
  await openRoomResponse(res, room, viewerOf(req), created ? 201 : 200);
});

/**
 * POST /tours/:id/messages { text } — "Message Tour Guide" on a tour page. Goes to the chat with
 * the tour's guide (or its agency when there's no guide), with the tour attached to the message.
 */
exports.askAboutTour = catchAsync(async (req, res, next) => {
  assertTraveler(req.user);
  const tour = validId(req.params.id) ? await Package.findOne({ _id: req.params.id, status: { $in: ['published', 'cancelled'] } }).select('title agency guide') : null;
  const agency = tour && await Agency.findOne({ _id: tour.agency, status: 'active' }).select('name logo');
  if (!tour || !agency) return next(new AppError('This tour is not available.', 404));
  if (!String(req.body.text || '').trim()) return next(new AppError('Write a message.', 400));
  const [room] = await roomForTourQuestion(tour, agency, req.user);
  const viewer = viewerOf(req);
  const message = await sendMessage(room, viewer, req, { tour: tour._id });
  await sentResponse(res, room, viewer, message, { chat: true, top: { message: `Sent to ${agency.name}. You'll get a notification when they reply.` } });
});

/** POST /chats/support — "Customer Support": the traveler's one chat with Plejar staff */
exports.startSupport = catchAsync(async (req, res) => {
  assertTraveler(req.user);
  const [room, created] = await findOrCreateRoom(`support:${req.user._id}`, {
    kind: 'support',
    title: 'Customer Support',
    searchText: `Customer Support ${req.user.name}`,
    members: [{ user: req.user._id, lastReadAt: new Date() }]
  });
  // A support chat closed by staff opens again when the traveler comes back
  if (!created && room.status === 'closed') {
    room.status = 'active';
    await room.save();
    broadcastRoom(room._id);
  }
  await openRoomResponse(res, room, viewerOf(req), created ? 201 : 200);
});

/**
 * POST /chats/tours/:tourId — open a tour's group chat. Travelers with a confirmed booking join;
 * others are told to book first.
 */
exports.openTourGroup = catchAsync(async (req, res, next) => {
  assertTraveler(req.user);
  const booking = validId(req.params.tourId)
    ? await Booking.findOne({ user: req.user._id, package: req.params.tourId, kind: 'tour', status: { $in: IN_GROUP } })
    : null;
  if (!booking) {
    const pending = validId(req.params.tourId) && await Booking.exists({ user: req.user._id, package: req.params.tourId, status: 'pending' });
    return next(new AppError(pending ? 'You join the group chat once the agency confirms your booking.' : 'Book this tour to join its group chat.', 403));
  }
  const room = await joinTourGroup(booking, req.user);
  if (!room) return next(new AppError('This group chat is not available.', 404));
  await openRoomResponse(res, await ChatRoom.findById(room._id), viewerOf(req));
});

// ---------- Agency (vendor panel) ----------

// POST /agency/me/chats/tours/:tourId — the agency opens (or makes) one of its tours' group chat
exports.agencyOpenTourGroup = catchAsync(async (req, res, next) => {
  const tour = validId(req.params.tourId) ? await Package.findOne({ _id: req.params.tourId, agency: req.agency._id }).select('title photos agency guide status') : null;
  if (!tour) return next(new AppError('No tour of yours with that ID.', 404));
  const room = await ensureTourGroup(tour);
  // Travelers confirmed before group chats existed join now
  const bookings = await Booking.find({ package: tour._id, kind: 'tour', status: { $in: IN_GROUP } }).select('user package kind status');
  const missing = bookings.filter(b => !anyMember(room, b.user));
  if (missing.length) {
    missing.forEach(b => room.members.push({ user: b.user }));
    await room.save();
    broadcastRoom(room._id);
  }
  if (tour.guide && String(room.guide || '') !== String(tour.guide)) await ChatRoom.updateOne({ _id: room._id }, { guide: tour.guide });
  await openRoomResponse(res, await ChatRoom.findById(room._id), viewerOf(req));
});

// ---------- Agency and support: marking a chat done ----------

/**
 * PATCH /agency/me/chats/:id or /admin/support-chats/:id { status: 'active' | 'closed' }.
 * Agencies close their direct chats (a new message opens them again); staff close support chats.
 */
exports.setStatus = catchAsync(async (req, res, next) => {
  const viewer = viewerOf(req);
  const room = await findRoom(req, viewer);
  if (!['active', 'closed'].includes(req.body.status)) return next(new AppError('Send status: active or closed.', 400));
  if (viewer.side === 'agency' && !REOPENS.includes(room.kind)) return next(new AppError("A tour's group chat closes only when the tour is cancelled.", 400));
  room.status = req.body.status;
  await room.save();
  broadcastRoom(room._id);
  await openRoomResponse(res, room, viewer);
});
