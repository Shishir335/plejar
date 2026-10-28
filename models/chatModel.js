const mongoose = require('mongoose');

/**
 * Chat in the app ("Messages"). Two kinds of rooms:
 * - group: a tour's group chat (the agency, its guide and the travelers booked on the tour)
 * - direct: one traveler with another traveler, with a tour guide (the agency answers for the guide),
 *   with an agency (questions from a tour page whose tour has no guide),
 *   or with Plejar customer support (staff answer in the admin panel)
 * Travelers are members one by one. The agency and support take part as a "side": any of the
 * agency's team or any Plejar staff member can answer, and they share one unread count.
 * No sockets yet: the app polls (see controllers/chatController.js).
 */

const KINDS = ['tour_group', 'traveler', 'guide', 'agency', 'support'];
const SIDES = ['traveler', 'agency', 'support', 'system'];

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
    lastReadAt: Date,
    unread: { type: Number, default: 0 },
    muted: { type: Boolean, default: false },
    // Left the group (a cancelled booking): keeps the history readable, stops new messages
    leftAt: Date
  },
  { _id: false }
);

const chatRoomSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['group', 'direct'], required: true },
    kind: { type: String, enum: KINDS, required: true },
    // Makes each room unique: tour:<id>, traveler:<a>:<b>, guide:<guide>:<user>, agency:<agency>:<user>, support:<user>
    key: { type: String, required: true, unique: true },
    title: { type: String, trim: true, maxlength: 120, default: '' },
    // Names to match when searching conversations (the people in a direct chat)
    searchText: { type: String, default: '' },
    photo: { type: String, default: '' },
    tour: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency' },
    guide: { type: mongoose.Schema.ObjectId, ref: 'Guide' },
    members: { type: [memberSchema], default: [] },
    // The agency's and support's shared side of the room
    agencyUnread: { type: Number, default: 0 },
    agencyLastReadAt: Date,
    supportUnread: { type: Number, default: 0 },
    supportLastReadAt: Date,
    lastMessage: {
      text: { type: String, default: '' },
      type: { type: String, default: 'text' },
      senderName: { type: String, default: '' },
      sender: { type: mongoose.Schema.ObjectId, ref: 'User' },
      side: { type: String, default: '' }
    },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    messageCount: { type: Number, default: 0 },
    // closed: a cancelled tour's group (read-only), a support chat staff finished, or a direct chat the
    // agency marked done (a new message from the traveler opens it again)
    status: { type: String, enum: ['active', 'closed'], default: 'active' }
  },
  { timestamps: true }
);

chatRoomSchema.index({ 'members.user': 1, lastMessageAt: -1 });
chatRoomSchema.index({ agency: 1, lastMessageAt: -1 });
chatRoomSchema.index({ kind: 1, lastMessageAt: -1 });

const attachmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['image', 'file'], required: true },
    // Stored outside /public; served through the chat's own signed-in route
    file: { type: String, required: true },
    name: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    width: Number,
    height: Number
  },
  { _id: true }
);

const chatMessageSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.ObjectId, ref: 'ChatRoom', required: true },
    sender: { type: mongoose.Schema.ObjectId, ref: 'User' },
    side: { type: String, enum: SIDES, required: true },
    // What the app shows as the sender: a traveler's name, "Tour Guide Marco", "Plejar Support"
    senderName: { type: String, default: '' },
    senderPhoto: { type: String, default: '' },
    asGuide: { type: mongoose.Schema.ObjectId, ref: 'Guide' },
    // The tour a question is about ("Message Tour Guide" on a tour page)
    tour: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    // Moved over from the old tour-page conversations (keeps the move from running twice)
    legacyId: { type: mongoose.Schema.ObjectId, index: { sparse: true } },
    type: { type: String, enum: ['text', 'image', 'file', 'system'], default: 'text' },
    text: { type: String, trim: true, maxlength: [4000, 'Keep messages under 4000 characters'], default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    deletedAt: Date
  },
  { timestamps: true }
);

chatMessageSchema.index({ room: 1, createdAt: -1 });

const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
ChatRoom.KINDS = KINDS;
module.exports = { ChatRoom, ChatMessage };
