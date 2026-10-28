const { Conversation, Message } = require('../models/conversationModel');
const { ChatRoom, ChatMessage } = require('../models/chatModel');
const Agency = require('../models/agencyModel');
const Package = require('../models/packageModel');
const User = require('../models/userModel');
const Notification = require('../models/notificationModel');
const { roomForTourQuestion, agencyRoom, guideSenderName } = require('./chats');

/**
 * Moves the old tour-page conversations ("Message Tour Guide", models/conversationModel.js) into the
 * chat: each thread goes to the traveler's chat with the tour's guide, or with the agency, and its
 * messages keep their times and carry the tour. Threads already moved are skipped, so it is safe to
 * run again. Old records are left in place. Returns { threads, messages, skipped }.
 */
const migrateConversations = async (filter = {}) => {
  const result = { threads: 0, messages: 0, skipped: 0 };
  const threads = await Conversation.find({ ...filter, chatRoom: null });
  // One thread at a time, oldest first, so rooms that several threads share get their messages in order
  threads.sort((a, b) => a.createdAt - b.createdAt);
  for (const c of threads) { // eslint-disable-line no-restricted-syntax
    /* eslint-disable no-await-in-loop */
    const [agency, traveler, tour] = await Promise.all([
      Agency.findById(c.agency).select('name logo'),
      User.findById(c.traveler).select('name photo').setOptions({ includeInactive: true }),
      c.tour ? Package.findById(c.tour).select('title agency guide').populate('guide', 'name photo agency active') : null
    ]);
    if (!agency || !traveler) {
      result.skipped += 1;
      continue; // eslint-disable-line no-continue
    }
    const [room] = tour ? await roomForTourQuestion(tour, agency, traveler) : await agencyRoom(agency, traveler);
    const guide = room.kind === 'guide' && tour && tour.guide;
    const old = await Message.find({ conversation: c._id }).sort({ createdAt: 1 }).lean();
    const done = new Set((await ChatMessage.find({ legacyId: { $in: old.map(m => m._id) } }).select('legacyId').lean()).map(m => String(m.legacyId)));
    const fresh = old.filter(m => !done.has(String(m._id)));
    if (fresh.length) {
      // The agency's answers show as the guide in a guide chat, as the agency otherwise
      const agencyAs = guide ? { name: guideSenderName(guide), photo: guide.photo || '' } : { name: agency.name, photo: agency.logo || '' };
      await ChatMessage.insertMany(fresh.map(m => ({
        room: room._id,
        sender: m.sender,
        side: m.side === 'agency' ? 'agency' : 'traveler',
        senderName: m.side === 'agency' ? agencyAs.name : traveler.name,
        senderPhoto: m.side === 'agency' ? agencyAs.photo : '',
        asGuide: m.side === 'agency' && guide ? guide._id : undefined,
        type: 'text',
        text: m.text,
        tour: c.tour || undefined,
        legacyId: m._id,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt
      })), { timestamps: false });
      result.messages += fresh.length;
    }
    // The room's preview, counts and unread numbers include the moved thread
    const last = await ChatMessage.findOne({ room: room._id }).sort({ createdAt: -1 }).lean();
    const update = {
      $inc: { messageCount: fresh.length, agencyUnread: c.agencyUnread || 0, 'members.$[me].unread': c.travelerUnread || 0 },
      $set: {
        lastMessageAt: last ? last.createdAt : room.lastMessageAt,
        lastMessage: last ? { text: last.text.slice(0, 140), type: last.type, senderName: last.senderName, sender: last.sender, side: last.side } : room.lastMessage
      }
    };
    // A thread the agency had closed stays closed, unless the chat has newer messages
    if (c.status === 'closed' && (!last || last.createdAt <= c.lastMessageAt)) update.$set.status = 'closed';
    await ChatRoom.updateOne({ _id: room._id }, update, { arrayFilters: [{ 'me.user': traveler._id }] });
    c.chatRoom = room._id;
    await c.save();
    await Notification.updateMany({ conversation: c._id }, { chat: room._id });
    result.threads += 1;
    /* eslint-enable no-await-in-loop */
  }
  return result;
};

module.exports = { migrateConversations };
