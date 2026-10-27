const mongoose = require('mongoose');

/**
 * Vouchers & Rewards: offers travelers buy with loyalty points ("Weekend Getaway, 25% OFF, 1500 points").
 * Plejar creates them in the admin panel. Redeeming one gives the traveler a personal code (UserVoucher).
 */
const CATEGORIES = ['hotel', 'tour', 'guide', 'flight', 'airport', 'transport', 'restaurant'];
// Tour, hotel and guide vouchers can be used on a booking in the app; the rest are shown at the partner
const BOOKABLE = ['tour', 'hotel', 'guide'];

const voucherSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Give the voucher a title'], trim: true, maxlength: [80, 'Keep the title under 80 characters'] },
    description: { type: String, trim: true, maxlength: [2000, 'Keep the description under 2000 characters'], default: '' },
    category: { type: String, enum: { values: CATEGORIES, message: 'Choose a category' }, required: true },
    image: { type: String, default: '' },
    // What it gives: a percentage off, a fixed amount off, or something free (an upgrade, lounge access)
    discount: {
      type: { type: String, enum: ['percent', 'amount', 'free'], default: 'percent' },
      value: { type: Number, min: 0, default: 0 }, // percent (1-100) or taka
      maxAmount: { type: Number, min: 0, default: null } // cap on a percentage discount, in taka
    },
    pointsCost: { type: Number, required: [true, 'Set how many points it costs'], min: [0, 'Points cannot be negative'] },
    // A short public code for the offer, e.g. WEEKEND25 (each redemption also gets its own personal code)
    code: { type: String, uppercase: true, trim: true, maxlength: 30 },
    destination: { type: mongoose.Schema.ObjectId, ref: 'Destination' },
    locationLabel: { type: String, trim: true, maxlength: 120, default: '' },
    // When it can be used, e.g. "August 15-20, 2025"
    usableFrom: Date,
    usableUntil: Date,
    // How long a redeemed voucher stays valid (when there's no fixed end date)
    validDays: { type: Number, min: 1, max: 730, default: 90 },
    minSpend: { type: Number, min: 0, default: 0 },
    terms: { type: [String], default: [] },
    stock: { type: Number, min: 0, default: null }, // how many can be redeemed in total (empty = no limit)
    perUserLimit: { type: Number, min: 1, default: 1 },
    redeemedCount: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

voucherSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } });
voucherSchema.index({ active: 1, category: 1, pointsCost: 1 });

const userVoucherSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    voucher: { type: mongoose.Schema.ObjectId, ref: 'Voucher', required: true },
    code: { type: String, required: true, uppercase: true }, // personal code, e.g. WEEKEND25-7K3Q
    pointsSpent: { type: Number, required: true, min: 0 },
    expiresAt: Date,
    status: { type: String, enum: ['active', 'used', 'expired'], default: 'active' },
    usedAt: Date,
    booking: { type: mongoose.Schema.ObjectId, ref: 'Booking' },
    discountGiven: { type: Number, default: 0 }
  },
  { timestamps: true }
);

userVoucherSchema.index({ code: 1 }, { unique: true });
userVoucherSchema.index({ user: 1, createdAt: -1 });
userVoucherSchema.index({ user: 1, voucher: 1 });

const Voucher = mongoose.model('Voucher', voucherSchema);
const UserVoucher = mongoose.model('UserVoucher', userVoucherSchema);
Voucher.CATEGORIES = CATEGORIES;
Voucher.BOOKABLE = BOOKABLE;
module.exports = { Voucher, UserVoucher };
