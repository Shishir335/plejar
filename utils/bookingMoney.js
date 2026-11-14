/**
 * Booking money: what a traveler pays online, through bKash or SSLCommerz, to book a tour (the tour's
 * booking money per traveler) or ask a hotel for a stay (the hotel's booking money per room). The
 * amount always comes from the tour or hotel in the database, never from the app.
 *
 * Nothing is booked until the money arrives: the request waits on the Payment (its draft), and the
 * booking or stay request is made when the gateway confirms it (utils/payments/ledger.js). Plejar holds
 * the money and pays it out to the vendor with their earnings, less commission.
 *
 * Refunds: in full when the vendor declines or cancels, the request expires, or the traveler cancels before
 * it's confirmed. Once confirmed (or accepted), a traveler who cancels gets the tour's or hotel's
 * cancellation refund (cancelRefund: a percent, if at least so many days before it starts); the rest is
 * kept for the vendor.
 */
const Payment = require('../models/paymentModel');
const User = require('../models/userModel');
const AppError = require('./appError');
const { logActivity } = require('./activity');
const config = require('./payments/config');
const ledger = require('./payments/ledger');
const { cancelRefundOf, cancelRefundView } = require('./cancelRefund');

/** What the app needs to show a booking-money payment and follow it */
const paymentView = p => ({
  _id: p._id,
  purpose: p.purpose,
  description: p.description,
  amount: p.amount,
  perUnit: p.perUnit,
  units: p.units,
  method: p.method,
  status: p.status,
  sandbox: p.sandbox,
  booking: p.booking || null,
  stayRequest: p.stayRequest || null,
  // Why it didn't go through, or why it was refunded
  reason: p.failedReason || (p.refund && p.refund.reason) || '',
  trxId: p.trxId || '',
  paidAt: p.paidAt || null,
  createdAt: p.createdAt
});

/**
 * Open a booking-money payment for a request that has been checked (the booking or stay controller).
 * Returns { payment, redirectUrl, methods }.
 */
const start = async (req, { purpose, method, agency, amount, perUnit, units, description, draft }) => {
  const methods = config.enabledMethods();
  if (!method) {
    // Older app versions can't pay: ask them to update rather than booking without the money
    throw new AppError(`This needs ${amount} taka booking money paid online. Update the Plejar app to pay and book.`, 400);
  }
  if (!methods.length) throw new AppError('Online payment is not available right now. Please try again later.', 503);
  if (!methods.includes(String(method))) throw new AppError('Choose bKash or card (SSLCommerz) to pay the booking money.', 400);
  const payment = await Payment.create({
    purpose,
    agency,
    user: req.user._id,
    description: String(description).slice(0, 200),
    amount,
    perUnit,
    units,
    draft,
    method,
    invoice: ledger.newInvoice(purpose === 'stay' ? 'PLJST' : 'PLJBK'),
    sandbox: !config.isLive()
  });
  const redirectUrl = await ledger.open(req, payment, {
    customer: { name: req.user.name, email: req.user.email, phone: req.user.phone },
    product: description
  });
  await logActivity(req, { action: `${purpose}.payment_started`, summary: `Started paying ${amount} BDT booking money by ${ledger.GATEWAY_NAMES[method]}: ${description}`, user: req.user._id, agency });
  return { payment: paymentView(payment), redirectUrl, methods };
};

/** The gateway confirmed the money: make the booking or send the stay request (called by the ledger) */
const onPaid = async paid => {
  const user = await User.findById(paid.user);
  if (!user || user.deletedAt) return { ok: false, reason: 'The account that paid is gone' };
  try {
    if (paid.purpose === 'booking') {
      const booking = await require('../controllers/bookingController').placePaidBooking(user, paid);
      await Payment.updateOne({ _id: paid._id }, { $set: { booking: booking._id } });
    } else {
      const request = await require('../controllers/stayController').placePaidStay(user, paid);
      await Payment.updateOne({ _id: paid._id }, { $set: { stayRequest: request._id } });
    }
  } catch (err) {
    if (!err.isOperational) throw err;
    // Seats or rooms went while paying, or the traveler already had it: the ledger refunds
    return { ok: false, reason: err.message };
  }
  return { ok: true };
};

// The calendar day in Bangladesh, as a count of days, so "3 days before" doesn't depend on the hour
const DHAKA_MS = 6 * 60 * 60 * 1000;
const dhakaDay = date => Math.floor((new Date(date).getTime() + DHAKA_MS) / 86400000);

/** Whole days from today (in Bangladesh) to the day `start` falls on */
const daysBefore = (start, now = new Date()) => dhakaDay(start) - dhakaDay(now);

/**
 * Booking money a traveler gets back for cancelling a confirmed booking (or accepted stay) now:
 * the saved cancellation refund's percent when it's at least its days before `start`, else 0.
 */
const lateCancelRefund = (doc, start, now = new Date()) => {
  const policy = cancelRefundOf(doc);
  if (!policy || !(doc.depositAmount > 0) || !start) return 0;
  if (daysBefore(start, now) < policy.days) return 0;
  return Math.floor((doc.depositAmount * policy.percent) / 100);
};

/**
 * Booking money the traveler would get back for cancelling now: all of it while the booking waits
 * on the vendor, the cancellation refund once confirmed, nothing once it's over or already settled.
 */
const refundIfCancelled = (doc, kind, now = new Date()) => {
  if (!doc || doc.depositStatus !== 'paid' || !(doc.depositAmount > 0)) return 0;
  if (doc.status === 'pending') return doc.depositAmount;
  const confirmed = kind === 'stay' ? doc.status === 'accepted' : doc.status === 'confirmed';
  return confirmed ? lateCancelRefund(doc, kind === 'stay' ? doc.checkIn : doc.travelDate, now) : 0;
};

/**
 * Give a booking's or stay request's booking money back: all of it (the vendor declined, it expired, or
 * the traveler cancelled in time) or `amount` taka of it (a late cancellation's refund). `Model` is
 * Booking or StayRequest. Never throws.
 */
const refundDeposit = async (Model, doc, { reason, by, amount } = {}) => {
  if (!doc || !doc.depositPayment || !['paid', 'refund_failed'].includes(doc.depositStatus)) return null;
  const total = doc.depositAmount > 0 ? doc.depositAmount : ((await Model.findById(doc._id).select('depositAmount').lean()) || {}).depositAmount || 0;
  const part = Number(amount) > 0 ? Math.min(Math.round(Number(amount)), total) : total;
  const claimed = await Model.findOneAndUpdate(
    { _id: doc._id, depositStatus: { $in: ['paid', 'refund_failed'] } },
    { $set: { depositStatus: 'refunding', depositRefunded: part } },
    { new: true }
  );
  if (!claimed) return null;
  if (doc.depositRefunded !== undefined) doc.depositRefunded = part;
  try {
    const payment = await Payment.findById(claimed.depositPayment);
    const after = payment ? await ledger.refund(payment, { reason, by, amount: part }) : null;
    const status = after && after.status === 'refunded' ? 'refunded' : 'refund_failed';
    await Model.updateOne({ _id: claimed._id }, { $set: { depositStatus: status } });
    if (doc.depositStatus !== undefined) doc.depositStatus = status;
    return after;
  } catch (err) {
    console.error('[PAYMENTS] Booking money refund failed:', err.message);
    await Model.updateOne({ _id: claimed._id }, { $set: { depositStatus: 'refund_failed' } });
    return null;
  }
};

/**
 * The traveler cancelled after the vendor confirmed (`start`: the tour's start or check-in): they get the
 * cancellation refund if it's early enough, and the rest stays with the vendor. Never throws.
 */
const cancelledLate = async (Model, doc, start, { by } = {}) => {
  if (!doc || doc.depositStatus !== 'paid') return null;
  const back = lateCancelRefund(doc, start);
  if (back <= 0) return keepDeposit(Model, doc);
  const policy = cancelRefundOf(doc);
  return refundDeposit(Model, doc, { amount: back, by, reason: `Cancelled ${policy.days}+ days before: ${policy.percent}% of the booking money back` });
};

/** The traveler cancelled after the vendor confirmed, too late for a refund: the booking money stays with the vendor */
const keepDeposit = async (Model, doc) => {
  if (!doc || doc.depositStatus !== 'paid') return;
  await Model.updateOne({ _id: doc._id, depositStatus: 'paid' }, { $set: { depositStatus: 'kept' } });
  doc.depositStatus = 'kept';
};

/** A refund that failed and was later settled by an admin (from the payments list) */
const refundSettled = async payment => {
  const Model = payment.purpose === 'booking' ? require('../models/bookingModel') : require('../models/stayRequestModel');
  await Model.updateOne({ depositPayment: payment._id, depositStatus: { $in: ['refund_failed', 'refunding'] } }, { $set: { depositStatus: 'refunded' } });
};

/**
 * How the app shows booking money on a booking or stay card (`kind`: 'booking' or 'stay'): what was
 * paid, what came back (refunded: all of it unless a late cancellation's part), the cancellation
 * refund, and what cancelling now would give back.
 */
const depositView = (doc, kind = 'booking') => {
  if (!(doc.depositAmount > 0)) return null;
  const refunding = ['refunding', 'refunded', 'refund_failed'].includes(doc.depositStatus);
  return {
    amount: doc.depositAmount,
    status: doc.depositStatus,
    refunded: refunding ? doc.depositRefunded || doc.depositAmount : 0,
    cancelRefund: cancelRefundView(doc),
    refundIfCancelled: refundIfCancelled(doc, kind)
  };
};

module.exports = { paymentView, start, onPaid, refundDeposit, keepDeposit, cancelledLate, refundSettled, depositView, daysBefore, lateCancelRefund, refundIfCancelled };
