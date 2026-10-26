const mongoose = require('mongoose');

/**
 * Loyalty points: earned on completed trips and referrals, spent on vouchers, adjusted by Plezar.
 * The balance is the sum of a traveler's entries.
 */
const KINDS = ['earned', 'reversed', 'redeemed', 'adjusted', 'bonus'];

const pointsSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    points: { type: Number, required: true }, // positive to add, negative to take away
    kind: { type: String, enum: KINDS, required: true },
    reason: { type: String, trim: true, maxlength: 200, default: '' },
    booking: { type: mongoose.Schema.ObjectId, ref: 'Booking' },
    by: { type: mongoose.Schema.ObjectId, ref: 'User' },
    voucher: { type: mongoose.Schema.ObjectId, ref: 'UserVoucher' }, // what the points were spent on
    friend: { type: mongoose.Schema.ObjectId, ref: 'User' } // referral bonuses: who joined or travelled
  },
  { timestamps: true }
);

pointsSchema.index({ user: 1, createdAt: -1 });
pointsSchema.index({ booking: 1, kind: 1 });

const PointsEntry = mongoose.model('PointsEntry', pointsSchema);
PointsEntry.KINDS = KINDS;
module.exports = PointsEntry;
