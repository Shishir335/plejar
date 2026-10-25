const mongoose = require('mongoose');

// A traveler blocking another: neither sees the other's posts or comments, and they can't interact
const blockSchema = new mongoose.Schema(
  {
    blocker: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    blocked: { type: mongoose.Schema.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
blockSchema.index({ blocked: 1 });

module.exports = mongoose.model('Block', blockSchema);
