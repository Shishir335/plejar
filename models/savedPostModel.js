const mongoose = require('mongoose');

// A post a traveler saved to look at later
const savedPostSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    post: { type: mongoose.Schema.ObjectId, ref: 'Post', required: true }
  },
  { timestamps: true }
);

savedPostSchema.index({ user: 1, post: 1 }, { unique: true });
savedPostSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SavedPost', savedPostSchema);
