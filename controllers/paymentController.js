const mongoose = require('mongoose');
const Payment = require('../models/paymentModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const bkash = require('../utils/payments/bkash');
const sslcommerz = require('../utils/payments/sslcommerz');
const config = require('../utils/payments/config');
const adPayments = require('../utils/adPayments');
const ledger = require('../utils/payments/ledger');
const bookingMoney = require('../utils/bookingMoney');

/**
 * Where bKash and SSLCommerz send the payer (and SSLCommerz its IPN) after a payment.
 * Nothing in these requests is trusted: each payment is checked with the gateway itself.
 * A vendor paying for an ad lands back on the Ads page of the agent panel; a traveler paying booking
 * money lands on a page that says to go back to the app (which checks GET /payments/:id).
 */

const str = v => String(v == null ? '' : v).trim().slice(0, 100);
const backToPanel = (res, outcome, code = 302, payment = null) => {
  if (payment && payment.purpose !== 'ad') return res.redirect(code, `/api/v1/payments/done?outcome=${encodeURIComponent(outcome)}`);
  return res.redirect(code, `/agent?payment=${encodeURIComponent(outcome)}#ads`);
};

const DONE_TEXT = {
  paid: ['Payment received', 'Your booking money is paid and your request has been sent. Go back to the Plejar app to see it.'],
  refunded: ['Payment refunded', "Your payment went through, but the booking couldn't be made (the seats or rooms may have just gone). The money is being refunded to you. Go back to the Plejar app to try again."],
  cancelled: ['Payment cancelled', 'You cancelled the payment. Nothing was booked. Go back to the Plejar app to try again.'],
  failed: ['Payment not completed', 'The payment did not go through, so nothing was booked. Go back to the Plejar app to try again.']
};

// GET /payments/done?outcome= — the last page a traveler sees in the payment browser
exports.done = (req, res) => {
  const [title, body] = DONE_TEXT[req.query.outcome] || DONE_TEXT.failed;
  res.status(200).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Plejar</title>
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#1d2433;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
main{background:#fff;border-radius:16px;padding:28px 24px;max-width:420px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)}h1{font-size:22px;margin:0 0 12px}p{line-height:1.5;margin:0;color:#4a5263}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`);
};

// GET /payments/bkash/callback?paymentID&status=success|failure|cancel
exports.bkashCallback = catchAsync(async (req, res) => {
  const paymentID = str(req.query.paymentID);
  const payment = paymentID ? await Payment.findOne({ gatewayId: paymentID, method: 'bkash' }) : null;
  if (!payment) return backToPanel(res, 'failed');
  const status = str(req.query.status);
  if (status !== 'success') {
    await Payment.updateOne({ _id: payment._id, status: 'started' }, { $set: { status: status === 'cancel' ? 'cancelled' : 'failed', failedReason: `bKash: ${status || 'no status'}` } });
    return backToPanel(res, status === 'cancel' ? 'cancelled' : 'failed', 302, payment);
  }
  let result;
  try {
    result = await bkash.execute(paymentID);
  } catch (err) {
    console.error(`[PAYMENTS] bKash execute ${payment.invoice}:`, err.message);
    result = { paid: false, reason: err.message };
  }
  backToPanel(res, await ledger.settle(payment, result), 302, payment);
});

// The SSLCommerz payment named in a post back, checked with SSLCommerz; null when it isn't one of ours
const sslResult = async req => {
  const tranId = str(req.body.tran_id);
  const payment = tranId ? await Payment.findOne({ invoice: tranId, method: 'sslcommerz' }) : null;
  if (!payment) return {};
  const valId = str(req.body.val_id);
  if (!valId) return { payment, result: { paid: false, reason: `SSLCommerz: ${str(req.body.status) || 'no val_id'}` } };
  try {
    return { payment, result: { ...(await sslcommerz.validate(valId)), valId } };
  } catch (err) {
    console.error(`[PAYMENTS] SSLCommerz validation ${payment.invoice}:`, err.message);
    return { payment, result: { paid: false, reason: err.message } };
  }
};

// POST /payments/sslcommerz/success (the vendor's browser, sent by SSLCommerz)
exports.sslSuccess = catchAsync(async (req, res) => {
  const { payment, result } = await sslResult(req);
  if (!payment) return backToPanel(res, 'failed', 303);
  backToPanel(res, await ledger.settle(payment, result), 303, payment);
});

// POST /payments/sslcommerz/fail and /cancel: only a payment still in progress is marked; a later success still counts
const sslStopped = outcome => catchAsync(async (req, res) => {
  const tranId = str(req.body.tran_id);
  const payment = tranId ? await Payment.findOne({ invoice: tranId, method: 'sslcommerz' }).select('purpose') : null;
  if (payment) await Payment.updateOne({ _id: payment._id, status: 'started' }, { $set: { status: outcome, failedReason: `SSLCommerz: ${str(req.body.error || req.body.status) || outcome}` } });
  backToPanel(res, outcome, 303, payment);
});
exports.sslFail = sslStopped('failed');
exports.sslCancel = sslStopped('cancelled');

// POST /payments/sslcommerz/ipn (server to server): settles a payment even if the vendor closed the page
exports.sslIpn = catchAsync(async (req, res) => {
  const { payment, result } = await sslResult(req);
  if (payment && result.paid) await ledger.settle(payment, result);
  res.status(200).type('text/plain').send('OK');
});

// GET /payments/:id (signed in) — a traveler's own booking-money payment, which the app checks after paying
exports.myPayment = catchAsync(async (req, res, next) => {
  const payment = mongoose.isValidObjectId(req.params.id) ? await Payment.findOne({ _id: req.params.id, user: req.user._id, purpose: { $in: ['booking', 'stay'] } }) : null;
  if (!payment) return next(new AppError('No payment found with that ID.', 404));
  res.status(200).json({ status: 'success', data: { payment: bookingMoney.paymentView(payment) } });
});

// GET /payments?page= (signed in) — a traveler's own booking-money payments, newest first, 20 a page,
// with the agency or hotel owner each one went to
exports.myPayments = catchAsync(async (req, res) => {
  const limit = 20;
  const page = Math.max(1, Math.min(500, parseInt(req.query.page, 10) || 1));
  const filter = { user: req.user._id, purpose: { $in: ['booking', 'stay'] } };
  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('agency', 'name'),
    Payment.countDocuments(filter)
  ]);
  res.status(200).json({
    status: 'success',
    results: payments.length,
    total,
    page,
    hasMore: page * limit < total,
    data: {
      payments: payments.map(p => ({
        ...bookingMoney.paymentView(p),
        agency: p.agency && p.agency.name ? { _id: p.agency._id, name: p.agency.name } : null
      }))
    }
  });
});

// ---------- Admin ----------

const PURPOSE_NAMES = { ad: 'Ad', booking: 'Tour booking money', stay: 'Hotel booking money' };

const paymentView = p => ({
  _id: p._id,
  purpose: p.purpose,
  purposeName: PURPOSE_NAMES[p.purpose] || p.purpose,
  description: p.description,
  agency: p.agency && p.agency.name ? { _id: p.agency._id, name: p.agency.name } : null,
  paidBy: p.user && p.user.name ? p.user.name : '',
  amount: p.amount,
  days: p.days,
  pricePerDay: p.pricePerDay,
  perUnit: p.perUnit,
  units: p.units,
  method: p.method,
  status: p.status,
  invoice: p.invoice,
  trxId: p.trxId,
  sandbox: p.sandbox,
  flagged: p.flagged,
  paidAt: p.paidAt || null,
  refund: p.refund && p.refund.requestedAt ? { amount: p.refund.amount || p.amount, reason: p.refund.reason, ref: p.refund.ref, error: p.refund.error, manual: p.refund.manual, at: p.refund.at || null } : null,
  createdAt: p.createdAt
});

// GET/PATCH /admin/ad-settings { pricePerDay } — the ad price; only the master admin changes it
exports.adSettings = catchAsync(async (req, res, next) => {
  if (req.method === 'PATCH') {
    if (!['admin', 'dev'].includes(req.user.role)) return next(new AppError('Only the master admin can change the ad price.', 403));
    const price = Number(req.body.pricePerDay);
    if (!Number.isInteger(price) || price < 0 || price > adPayments.MAX_PRICE) return next(new AppError(`Enter a whole number of taka from 0 to ${adPayments.MAX_PRICE}.`, 400));
    await adPayments.setPricePerDay(price, req.user._id);
    await logActivity(req, { action: 'ads.price_updated', summary: price ? `Set the ad price to ${price} BDT a day` : 'Made ads free' });
  }
  res.status(200).json({ status: 'success', data: { settings: { ...(await adPayments.pricing()), live: config.isLive() } } });
});

const PAYMENT_FILTERS = {
  paid: { status: 'paid' },
  refund_due: { status: { $in: ['refund_failed', 'refunding'] } },
  refunded: { status: 'refunded' }
};

// GET /admin/ad-payments?status=paid|refund_due|refunded&purpose=ad|booking|stay (all purposes when left out)
exports.adPayments = catchAsync(async (req, res) => {
  const key = PAYMENT_FILTERS[req.query.status] ? req.query.status : 'paid';
  const scope = PURPOSE_NAMES[req.query.purpose] ? { purpose: req.query.purpose } : {};
  const [rows, counts] = await Promise.all([
    Payment.find({ ...scope, ...PAYMENT_FILTERS[key] }).sort({ createdAt: -1 }).limit(100).populate('agency', 'name').populate('user', 'name').lean(),
    Promise.all(Object.entries(PAYMENT_FILTERS).map(async ([k, f]) => [k, await Payment.countDocuments({ ...scope, ...f })]))
  ]);
  res.status(200).json({ status: 'success', data: { payments: rows.map(paymentView), counts: Object.fromEntries(counts) } });
});

/**
 * POST /admin/ad-payments/:id/refund { ref? } — for a refund the gateway turned down: with `ref`,
 * record one an admin made by hand (the bKash or bank reference); without it, ask the gateway again.
 */
exports.settleRefund = catchAsync(async (req, res, next) => {
  const payment = mongoose.isValidObjectId(req.params.id) ? await Payment.findById(req.params.id) : null;
  if (!payment) return next(new AppError('No payment with that ID.', 404));
  if (payment.status !== 'refund_failed') return next(new AppError('Only a refund that failed can be settled here.', 400));
  const ref = str(req.body.ref);
  let updated;
  if (ref) {
    if (ref.length < 3) return next(new AppError('Enter the reference of the refund you sent.', 400));
    updated = await Payment.findOneAndUpdate({ _id: payment._id, status: 'refund_failed' }, { $set: { status: 'refunded', 'refund.ref': ref, 'refund.manual': true, 'refund.at': new Date(), 'refund.by': req.user._id } }, { new: true });
  } else {
    updated = await ledger.refund(payment, { reason: payment.refund.reason || 'Refund', by: req.user._id });
  }
  const done = updated && updated.status === 'refunded';
  if (done && payment.purpose !== 'ad') await bookingMoney.refundSettled(payment);
  await logActivity(req, { action: payment.purpose === 'ad' ? 'ads.refund' : 'payments.refund', summary: `${ref ? 'Recorded a manual refund' : 'Retried the refund'} of ${(payment.refund && payment.refund.amount) || payment.amount} BDT (${payment.invoice}): ${done ? 'refunded' : 'still not refunded'}`, agency: payment.agency });
  res.status(done ? 200 : 502).json({ status: done ? 'success' : 'fail', message: done ? 'Refund recorded.' : `The gateway still refused: ${updated && updated.refund.error}`, data: { payment: paymentView(updated.toObject()) } });
});
