const { ChatRoom, ChatMessage } = require('../models/chatModel');
const Package = require('../models/packageModel');
const Booking = require('../models/bookingModel');
const Guide = require('../models/guideModel');
const { snippet } = require('./social');

// Chat helpers shared by the chat controller and the booking flow: tour group chats follow bookings

// Live updates live in the chat controller, which needs this file first: load it when used
const live = () => require('../controllers/chatController'); // eslint-disable-line global-require

// Travelers in a tour's group chat: confirmed bookings, and completed ones (they keep the history)
const IN_GROUP = ['confirmed', 'completed'];

/** A short message from Plejar in a room ("Rina joined the group") */
const systemMessage = async (room, text) => {
  const message = await ChatMessage.create({ room: room._id, side: 'system', senderName: 'Plejar', type: 'system', text });
  await ChatRoom.updateOne({ _id: room._id }, {
    lastMessage: { text: snippet(text, 140), type: 'system', senderName: 'Plejar', side: 'system' },
    lastMessageAt: message.createdAt,
    $inc: { messageCount: 1 }
  });
  live().broadcastMessage(room._id, message._id);
  return message;
};

/** The tour's group chat, made the first time anyone opens it */
const ensureTourGroup = async tourOrId => {
  const tour = tourOrId && tourOrId.agency ? tourOrId : await Package.findById(tourOrId).select('title photos agency guide status');
  if (!tour) return null;
  const key = `tour:${tour._id}`;
  const existing = await ChatRoom.findOne({ key });
  if (existing) return existing;
  try {
    const room = await ChatRoom.create({
      type: 'group',
      kind: 'tour_group',
      key,
      title: tour.title,
      photo: (tour.photos && tour.photos[0]) || '',
      tour: tour._id,
      agency: tour.agency,
      guide: tour.guide || undefined,
      status: tour.status === 'cancelled' ? 'closed' : 'active'
    });
    await systemMessage(room, `Welcome to the ${tour.title} group chat. Ask the organizer anything and meet your fellow travelers.`);
    return room;
  } catch (err) {
    // Two people opened it at the same moment
    if (err.code === 11000) return ChatRoom.findOne({ key });
    throw err;
  }
};

/** Add a traveler to their tour's group (a booking was confirmed). Safe to call again. */
const joinTourGroup = async (booking, user) => {
  if (!booking || booking.kind !== 'tour' || !booking.package || !IN_GROUP.includes(booking.status)) return null;
  const room = await ensureTourGroup(booking.package);
  if (!room) return null;
  const member = room.members.find(m => String(m.user) === String(booking.user));
  if (member && !member.leftAt) return room;
  if (member) {
    member.leftAt = undefined;
    member.joinedAt = new Date();
  } else room.members.push({ user: booking.user, lastReadAt: new Date() });
  await room.save();
  live().broadcastRoom(room._id);
  const name = user ? user.firstName || user.name : null;
  if (name) await systemMessage(room, `${name} joined the group.`);
  return room;
};

/** A cancelled booking: the traveler leaves the group (unless another booking keeps them in) */
const leaveTourGroup = async booking => {
  if (!booking || booking.kind !== 'tour' || !booking.package) return;
  const still = await Booking.exists({ _id: { $ne: booking._id }, user: booking.user, package: booking.package, status: { $in: IN_GROUP } });
  if (still) return;
  const room = await ChatRoom.findOneAndUpdate(
    { key: `tour:${booking.package}`, 'members.user': booking.user },
    { $set: { 'members.$.leftAt': new Date(), 'members.$.unread': 0 } }
  ).select('_id');
  if (room) live().broadcastRoom(room._id);
};

/** The whole tour was cancelled: tell the group and make it read-only */
const closeTourGroup = async (tourId, reason) => {
  const room = await ChatRoom.findOne({ key: `tour:${tourId}` });
  if (!room || room.status === 'closed') return;
  await systemMessage(room, `This tour was cancelled${reason ? `: ${reason}` : '.'} The chat is now read-only.`);
  await ChatRoom.updateOne({ _id: room._id }, { status: 'closed' });
  live().broadcastRoom(room._id);
};

/** Find a room by its key, or make it with these fields; returns [room, created] */
const findOrCreateRoom = async (key, fields) => {
  const existing = await ChatRoom.findOne({ key });
  if (existing) return [existing, false];
  try {
    return [await ChatRoom.create({ key, type: 'direct', ...fields }), true];
  } catch (err) {
    if (err.code === 11000) return [await ChatRoom.findOne({ key }), false];
    throw err;
  }
};

/** A traveler's direct chat with a tour guide (the guide's agency answers) */
const guideRoom = (guide, agency, user) => findOrCreateRoom(`guide:${guide._id}:${user._id}`, {
  kind: 'guide',
  title: `${guide.name} (Tour Guide)`,
  photo: guide.photo || '',
  searchText: `${guide.name} ${agency.name} ${user.name || ''}`,
  agency: agency._id,
  guide: guide._id,
  members: [{ user: user._id, lastReadAt: new Date() }]
});

/** A traveler's direct chat with an agency */
const agencyRoom = (agency, user) => findOrCreateRoom(`agency:${agency._id}:${user._id}`, {
  kind: 'agency',
  title: agency.name,
  photo: agency.logo || '',
  searchText: `${agency.name} ${user.name || ''}`,
  agency: agency._id,
  members: [{ user: user._id, lastReadAt: new Date() }]
});

/**
 * Where "Message Tour Guide" on a tour page goes: the chat with the tour's guide, or with the
 * agency when the tour has no (active) guide. `tour.guide` may be populated or an id.
 */
const roomForTourQuestion = async (tour, agency, user) => {
  const guide = tour.guide && (tour.guide.name ? tour.guide : await Guide.findById(tour.guide).select('name photo agency active'));
  if (guide && guide.active !== false && String(guide.agency) === String(agency._id)) return guideRoom(guide, agency, user);
  return agencyRoom(agency, user);
};

/** The name shown for a guide in chats, e.g. "Tour Guide Marco" */
const guideSenderName = guide => `Tour Guide ${String(guide.name || '').split(' ')[0]}`.trim();

const loadGuide = id => Guide.findById(id).select('name photo agency active title');

module.exports = { IN_GROUP, systemMessage, ensureTourGroup, joinTourGroup, leaveTourGroup, closeTourGroup, findOrCreateRoom, guideRoom, agencyRoom, roomForTourQuestion, guideSenderName, loadGuide };
