const mongoose = require('mongoose');

const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];

// One person's reaction to a post or a comment (changing it replaces the old one)
const reactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['post', 'comment'], required: true },
    target: { type: mongoose.Schema.ObjectId, required: true },
    kind: { type: String, enum: REACTIONS, default: 'like' }
  },
  { timestamps: true }
);

reactionSchema.index({ user: 1, targetType: 1, target: 1 }, { unique: true });
reactionSchema.index({ targetType: 1, target: 1, createdAt: -1 });

const Reaction = mongoose.model('Reaction', reactionSchema);
Reaction.KINDS = REACTIONS;
module.exports = Reaction;
