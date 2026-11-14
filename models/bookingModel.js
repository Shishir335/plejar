const mongoose = require('mongoose');
const { CANCEL_REFUND } = require('./cancelRefundSchema');
const crypto = require('crypto');

// Short readable reference shown to travelers and in admin, for example PLZ-7K3QX9
const makeReference = () => `PLZ-${crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase()}`;

const KINDS = ['tour', 'hotel', 'guide'];

const bookingSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, default: makeReference },
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true, index: true },
    // What was booked: a tour event, a hotel stay (listed by Plejar) or a day with an agency's guide
    kind: { type: String, enum: KINDS, default: 'tour', index: true },
    // Hotels are listed by Plejar, so a hotel booking has no agency
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', index: true, required: [function () { return this.kind !== 'hotel'; }, 'A booking needs an agency'] },
    package: { type: mongoose.Schema.ObjectId, ref: 'Package', required: [function () { return this.kind === 'tour'; }, 'A tour booking needs a tour'] },
    hotel: { type: mongoose.Schema.ObjectId, ref: 'Hotel', required: [function () { return this.kind === 'hotel'; }, 'A hotel booking needs a hotel'] },
    guide: { type: mongoose.Schema.ObjectId, ref: 'Guide', required: [function () { return this.kind === 'guide'; }, 'A guide booking needs a guide'] },

    // Snapshots, so history stays correct if the package is renamed or repriced later
    // (for hotels and guides: the hotel's or guide's name)
    packageTitle: { type: String, required: true },
    destination: { type: String, default: '' },
    destinationRef: { type: mongoose.Schema.ObjectId, ref: 'Destination' },

    travelDate: { type: Date, required: true }, // tour start, hotel check-in, first guided day
    endDate: Date, // tour end, hotel check-out, last guided day
    travelers: { type: Number, required: true, min: [1, 'At least one traveler'], max: [50, 'At most 50 travelers'] },
    // Hotels: rooms and nights; guides: days. Price is per person (tours), per room per night, or per day
    rooms: { type: Number, min: 1, max: 20, default: null },
    units: { type: Number, min: 1, max: 60, default: null },
    pricePerPerson: { type: Number, required: true, min: 0 },
    regularPrice: { type: Number, min: 0, default: null }, // the struck-through price when booked on sale
    amount: { type: Number, required: true, min: 0 }, // total charged to the traveler, in taka
    // A voucher from Vouchers & Rewards: Plejar pays the discount out of its commission
    subtotal: { type: Number, min: 0, default: null }, // price before the voucher
    discountAmount: { type: Number, min: 0, default: 0 },
    voucher: { type: mongoose.Schema.ObjectId, ref: 'UserVoucher' },
    voucherCode: { type: String, default: '' },
    // Or a coupon (one discount per booking). subtotal and discountAmount above hold its discount too.
    // A Plejar coupon: Plejar pays the discount, so plejarPays is added to the vendor's share.
    // A vendor's own coupon: the vendor pays it; its share and Plejar's commission come from the lower amount.
    couponCode: { type: String, default: '' },
    couponRedemption: { type: mongoose.Schema.ObjectId, ref: 'CouponRedemption' },
    couponFundedBy: { type: String, enum: ['plejar', 'vendor', null], default: null },
    plejarPays: { type: Number, min: 0, default: 0 },

    // Plejar's commission, a snapshot of the vendor's terms at booking time: none, a percent
    // (commissionRate) or a flat amount per booking (commissionFlat)
    commissionType: { type: String, enum: ['none', 'percent', 'amount'], default: 'percent' },
    commissionRate: { type: Number, required: true, min: 0, max: 100 }, // percent
    commissionFlat: { type: Number, min: 0, default: 0 }, // taka per booking
    commissionAmount: { type: Number, required: true, min: 0 }, // Plejar's share of `amount`

    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled'],
      default: 'pending',
      index: true
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'partially_refunded', 'refunded'],
      default: 'unpaid'
    },
    // Booking money the traveler paid online to Plejar (per traveler x travelers). Refunded when the agency declines or
    // the traveler cancels before it's confirmed; kept (and paid out to the vendor) once confirmed.
    depositAmount: { type: Number, min: 0, default: 0 },
    depositPayment: { type: mongoose.Schema.ObjectId, ref: 'Payment' },
    depositStatus: { type: String, enum: ['none', 'paid', 'refunding', 'refunded', 'refund_failed', 'kept'], default: 'none' },
    // The tour's or hotel's cancellation refund when it was booked, and how much of the booking money went back
    // (all of it unless it was a partial refund on a late cancellation)
    cancelRefund: { type: CANCEL_REFUND, default: null },
    depositRefunded: { type: Number, min: 0, default: 0 },
    paidAt: Date,
    confirmedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancelReason: { type: String, trim: true, maxlength: 500, default: '' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    // Loyalty points given when the trip was completed (taken back if it is cancelled after that)
    pointsAwarded: { type: Number, default: 0 },
    // When the day-before reminder went out
    remindedAt: Date
  },
  { timestamps: true }
);

bookingSchema.index({ createdAt: -1 });

bookingSchema.index({ guide: 1, travelDate: 1 });

const Booking = mongoose.model('Booking', bookingSchema);
Booking.KINDS = KINDS;
module.exports = Booking;
