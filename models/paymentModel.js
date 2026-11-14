const mongoose = require('mongoose');

/**
 * Money paid to Plejar through bKash or SSLCommerz:
 * - 'ad': an agent pays for an ad when applying; the ad goes to review once the gateway confirms it.
 * - 'booking': a traveler pays a tour's booking money; the booking is made once it's paid.
 * - 'stay': a traveler pays a hotel's booking money; the stay request is sent once it's paid.
 * For bookings and stays, `draft` keeps what the traveler asked for until then.
 *
 * started -> paid -> (refunding) -> refunded | refund_failed
 * started -> failed | cancelled (the agent can try again; a later success still counts)
 */
const STATUSES = ['started', 'paid', 'failed', 'cancelled', 'refunding', 'refunded', 'refund_failed'];
const METHODS = ['bkash', 'sslcommerz'];
const PURPOSES = ['ad', 'booking', 'stay'];

const paymentSchema = new mongoose.Schema(
  {
    purpose: { type: String, enum: PURPOSES, default: 'ad' },
    promotion: { type: mongoose.Schema.ObjectId, ref: 'Promotion' },
    booking: { type: mongoose.Schema.ObjectId, ref: 'Booking' },
    stayRequest: { type: mongoose.Schema.ObjectId, ref: 'StayRequest' },
    // The request a booking or stay payment will place once paid (never the amount: that comes from the tour or hotel)
    draft: { type: mongoose.Schema.Types.Mixed, default: undefined },
    // Who is paid in the end: the agency running the ad, tour or hotel
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', required: true },
    user: { type: mongoose.Schema.ObjectId, ref: 'User' },
    // What it was for, kept even if the ad is later deleted
    description: { type: String, trim: true, maxlength: 200, default: '' },

    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'BDT' },
    days: Number,
    pricePerDay: Number,
    // Booking money: taka per traveler (tours) or per room (stays), and how many
    perUnit: Number,
    units: Number,

    method: { type: String, enum: METHODS, required: true },
    status: { type: String, enum: STATUSES, default: 'started' },
    // Sent to the gateway as merchantInvoiceNumber (bKash) or tran_id (SSLCommerz)
    invoice: { type: String, required: true, unique: true },
    // bKash paymentID, or SSLCommerz sessionkey
    gatewayId: { type: String, default: '' },
    // bKash trxID, or SSLCommerz bank_tran_id: what the vendor sees on their statement
    trxId: { type: String, default: '' },
    // SSLCommerz val_id
    valId: { type: String, default: '' },
    sandbox: { type: Boolean, default: true },
    paidAt: Date,
    // SSLCommerz marked the card payment as risky: worth a look before accepting the ad
    flagged: { type: Boolean, default: false },
    failedReason: { type: String, default: '' },

    refund: {
      reason: { type: String, default: '' },
      // Taka sent back: all of it, or part on a late cancellation (unset: all)
      amount: Number,
      ref: { type: String, default: '' },
      error: { type: String, default: '' },
      manual: { type: Boolean, default: false },
      requestedAt: Date,
      at: Date,
      by: { type: mongoose.Schema.ObjectId, ref: 'User' }
    }
  },
  { timestamps: true }
);

paymentSchema.index({ promotion: 1, status: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ gatewayId: 1 });
paymentSchema.index({ user: 1, purpose: 1, createdAt: -1 });

const Payment = mongoose.model('Payment', paymentSchema);
Payment.STATUSES = STATUSES;
Payment.METHODS = METHODS;
module.exports = Payment;
