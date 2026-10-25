const mongoose = require('mongoose');

// Tours, destinations and hotels a traveler opened, for "Recently Viewed" (latest 20 kept)
const KINDS = ['tour', 'destination', 'hotel'];

const recentViewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: KINDS, required: true },
    item: { type: mongoose.Schema.ObjectId, required: true },
    viewedAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

recentViewSchema.index({ user: 1, kind: 1, item: 1 }, { unique: true });
recentViewSchema.index({ user: 1, viewedAt: -1 });

const RecentView = mongoose.model('RecentView', recentViewSchema);
RecentView.KINDS = KINDS;
module.exports = RecentView;
