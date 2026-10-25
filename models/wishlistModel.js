const mongoose = require('mongoose');

// The heart on tour and hotel cards
const KINDS = ['tour', 'hotel'];

const wishlistSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: KINDS, required: true },
    item: { type: mongoose.Schema.ObjectId, required: true }
  },
  { timestamps: true }
);

wishlistSchema.index({ user: 1, kind: 1, item: 1 }, { unique: true });
wishlistSchema.index({ user: 1, createdAt: -1 });

const Wishlist = mongoose.model('Wishlist', wishlistSchema);
Wishlist.KINDS = KINDS;
module.exports = Wishlist;
