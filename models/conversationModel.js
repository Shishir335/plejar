const mongoose = require('mongoose');

/**
 * OLD: a traveler's questions to an agency ("Message Tour Guide" on the tour page). These now live in
 * the chat (models/chatModel.js); this model stays only so older threads can be moved over.
 * One thread per traveler, agency and tour; the agency's team answers in the vendor panel.
 */
const conversationSchema = new mongoose.Schema(
  {
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', required: true },
    traveler: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    tour: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    tourTitle: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessage: { type: String, default: '' },
    lastSenderSide: { type: String, enum: ['traveler', 'agency'], default: 'traveler' },
    // Messages the other side hasn't read yet
    travelerUnread: { type: Number, default: 0 },
    agencyUnread: { type: Number, default: 0 },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    // Set once the thread was moved into the chat (utils/chatMigration.js)
    chatRoom: { type: mongoose.Schema.ObjectId, ref: 'ChatRoom' }
  },
  { timestamps: true }
);

conversationSchema.index({ traveler: 1, agency: 1, tour: 1 }, { unique: true });
conversationSchema.index({ agency: 1, lastMessageAt: -1 });
conversationSchema.index({ traveler: 1, lastMessageAt: -1 });

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.ObjectId, ref: 'Conversation', required: true },
    sender: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    side: { type: String, enum: ['traveler', 'agency'], required: true },
    text: { type: String, required: [true, 'Write a message'], trim: true, maxlength: [2000, 'Keep messages under 2000 characters'] }
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);
const Message = mongoose.model('Message', messageSchema);
module.exports = { Conversation, Message };
