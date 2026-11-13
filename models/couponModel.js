const mongoose = require('mongoose');

/**
 * Coupons travelers type in the app to get money off a tour, a guide or a hotel stay.
 *
 * Who pays for the discount:
 * - Plejar's coupons (made in the admin panel): Plejar. The vendor still gets its full share, as if
 *   the traveler paid the full price; Plejar adds the discount to what it owes the vendor.
 * - A tour agency's or hotel's own coupons (made in its panel): that vendor. Its share is worked out
 *   from the lower price, and only its own tours, guides or hotel can use them.
 *
 * Each use is a CouponRedemption, which holds what the coupon gave on that booking or stay request.
 */
const KINDS = ['tour', 'guide', 'hotel'];
const FUNDERS = ['plejar', 'vendor'];
const CODE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Enter a code, for example EID500'],
      uppercase: true,
      trim: true,
      match: [CODE, 'Use 3-20 letters, numbers or dashes for the code, for example EID500']
    },
    title: { type: String, required: [true, 'Give the coupon a title'], trim: true, maxlength: [80, 'Keep the title under 80 characters'] },
    description: { type: String, trim: true, maxlength: [500, 'Keep the description under 500 characters'], default: '' },

    discountType: { type: String, enum: { values: ['percent', 'amount'], message: 'Choose a percentage or a fixed amount' }, required: true },
    // Percent (1-100) or taka
    value: { type: Number, required: [true, 'Enter how much it takes off'], min: [1, 'The discount must be at least 1'] },
    // Most a percentage coupon can take off, in taka (empty = no limit)
    maxDiscount: { type: Number, min: [1, 'The limit must be at least ৳1'], default: null },
    minSpend: { type: Number, min: [0, 'The minimum spend cannot be negative'], default: 0 },

    // What it can be used on
    appliesTo: { type: [{ type: String, enum: KINDS }], default: KINDS },
    // Only this vendor's tours, guides or hotel. Always set on a vendor's own coupon; optional on Plejar's.
    vendor: { type: mongoose.Schema.ObjectId, ref: 'Agency', index: true },
    // Only these tours (a tour agency's coupon, or Plejar's for one agency); empty = all of them
    packages: { type: [{ type: mongoose.Schema.ObjectId, ref: 'Package' }], default: [] },
    fundedBy: { type: String, enum: FUNDERS, required: true },

    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    usageLimit: { type: Number, min: [1, 'The limit must be at least 1'], default: null }, // uses in total (empty = no limit)
    perUserLimit: { type: Number, min: [1, 'Each traveler can use it at least once'], max: 20, default: 1 },
    usedCount: { type: Number, min: 0, default: 0 },
    // Shown on the booking screen in the app; when off, travelers need to know the code
    visible: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },

    // Plejar can stop a vendor's coupon (for example a misleading one)
    blockedByAdmin: { type: Boolean, default: false },
    blockedReason: { type: String, trim: true, maxlength: 300, default: '' },

    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ fundedBy: 1, createdAt: -1 });

couponSchema.pre('validate', function () {
  if (this.discountType === 'percent' && this.value > 100) this.invalidate('value', 'A percentage can be at most 100');
  if (this.startsAt && this.endsAt && this.endsAt < this.startsAt) this.invalidate('endsAt', 'The end date is before the start date');
  if (!this.appliesTo || !this.appliesTo.length) this.invalidate('appliesTo', 'Choose what the coupon can be used on');
  if (this.fundedBy === 'vendor' && !this.vendor) this.invalidate('vendor', "A vendor's coupon needs its vendor");
});

const redemptionSchema = new mongoose.Schema(
  {
    coupon: { type: mongoose.Schema.ObjectId, ref: 'Coupon', required: true, index: true },
    code: { type: String, required: true },
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: KINDS, required: true },
    booking: { type: mongoose.Schema.ObjectId, ref: 'Booking' },
    stayRequest: { type: mongoose.Schema.ObjectId, ref: 'StayRequest' },
    // The vendor whose tour, guide or hotel it was used on
    vendor: { type: mongoose.Schema.ObjectId, ref: 'Agency', index: true },
    fundedBy: { type: String, enum: FUNDERS, required: true },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0 },
    // released: the booking or stay request was cancelled, declined or expired, so the use was given back
    status: { type: String, enum: ['applied', 'released'], default: 'applied', index: true },
    releasedAt: Date
  },
  { timestamps: true }
);

redemptionSchema.index({ coupon: 1, user: 1, status: 1 });

const Coupon = mongoose.model('Coupon', couponSchema);
const CouponRedemption = mongoose.model('CouponRedemption', redemptionSchema);
Coupon.KINDS = KINDS;
Coupon.CODE = CODE;
module.exports = { Coupon, CouponRedemption };
