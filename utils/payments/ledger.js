/**
 * Payments through bKash or SSLCommerz, whatever they are for: an ad (utils/adPayments.js), a tour's
 * booking money or a hotel stay's (utils/bookingMoney.js).
 *
 * open()   creates the gateway session for a Payment and returns where to send the payer.
 * settle() records what the gateway said and hands a paid payment to its purpose, which places the ad,
 *          booking or stay. When that can't happen any more (paid twice, seats gone) the money goes back.
 * refund() sends a paid payment's money back.
 */
const crypto = require('crypto');
const Payment = require('../../models/paymentModel');
const AppError = require('../appError');
const config = require('./config');
const bkash = require('./bkash');
const sslcommerz = require('./sslcommerz');

const GATEWAY_NAMES = { bkash: 'bKash', sslcommerz: 'SSLCommerz' };

const newInvoice = (prefix = 'PLJ') => `${prefix}${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// Callbacks come back to the address the payer is using (www.plejar.com, dev.plejar.com or localhost)
const baseUrl = req => `${req.protocol}://${req.get('host')}`;

/**
 * What happens once a payment is paid, by purpose: each returns { ok: true } once the thing paid for
 * exists, or { ok: false, reason } when it can't any more (the money is then refunded).
 * Loaded lazily so these modules can require this one.
 */
const PURPOSES = {
  ad: () => require('../adPayments').onPaid,
  booking: () => require('../bookingMoney').onPaid,
  stay: () => require('../bookingMoney').onPaid
};

/**
 * Open the gateway session for a saved Payment (status started, method set).
 * Returns the URL to send the payer to. On a gateway error the payment is marked failed and an
 * AppError (502) is thrown.
 */
const open = async (req, payment, { customer, product }) => {
  if (!config.enabledMethods().includes(payment.method)) throw new AppError('Choose bKash or SSLCommerz to pay.', 400);
  const base = baseUrl(req);
  try {
    const started = payment.method === 'bkash'
      ? await bkash.create({ amount: payment.amount, invoice: payment.invoice, payerReference: customer.phone || payment.invoice, callbackURL: `${base}/api/v1/payments/bkash/callback` })
      : await sslcommerz.create({
        amount: payment.amount,
        invoice: payment.invoice,
        urls: {
          success: `${base}/api/v1/payments/sslcommerz/success`,
          fail: `${base}/api/v1/payments/sslcommerz/fail`,
          cancel: `${base}/api/v1/payments/sslcommerz/cancel`,
          ipn: `${base}/api/v1/payments/sslcommerz/ipn`
        },
        customer,
        product
      });
    payment.gatewayId = started.gatewayId;
    await payment.save();
    return started.redirectUrl;
  } catch (err) {
    payment.status = 'failed';
    payment.failedReason = String(err.message || 'Gateway error').slice(0, 300);
    await payment.save();
    console.error(`[PAYMENTS] ${payment.method} could not start ${payment.invoice}:`, err.message);
    throw new AppError(`${GATEWAY_NAMES[payment.method]} could not start the payment. Please try again, or pay another way.`, 502);
  }
};

/**
 * Send a paid payment's money back through its gateway. Never throws; a refund the gateway
 * turns down is left as refund_failed for an admin to settle by hand.
 */
const refund = async (payment, { reason, by } = {}) => {
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['paid', 'refund_failed'] } },
    { $set: { status: 'refunding', 'refund.reason': reason || 'Refund', 'refund.requestedAt': new Date(), 'refund.error': '', 'refund.by': by } },
    { new: true }
  );
  if (!claimed) return Payment.findById(payment._id);
  let result;
  try {
    result = claimed.method === 'bkash'
      ? await bkash.refund({ gatewayId: claimed.gatewayId, trxId: claimed.trxId, amount: claimed.amount, reason })
      : await sslcommerz.refund({ trxId: claimed.trxId, amount: claimed.amount, reason, refundId: `R${claimed.invoice}`.slice(0, 30) });
  } catch (err) {
    result = { done: false, reason: err.message };
  }
  if (!result.done) console.error(`[PAYMENTS] Refund of ${claimed.invoice} failed:`, result.reason);
  return Payment.findByIdAndUpdate(claimed._id, result.done
    ? { $set: { status: 'refunded', 'refund.ref': result.ref, 'refund.at': new Date() } }
    : { $set: { status: 'refund_failed', 'refund.error': String(result.reason || 'Refund failed').slice(0, 300) } }, { new: true });
};

/**
 * What the gateway said about a payment: { paid, trxId, amount, currency, invoice, valId?, risky?, reason }.
 * Safe to call twice (SSLCommerz posts the success page and the IPN): only the first call that marks
 * it paid places what was paid for. Returns 'paid', 'failed' or 'refunded'.
 */
const settle = async (payment, result) => {
  if (!result.paid) {
    await Payment.updateOne({ _id: payment._id, status: 'started' }, { $set: { status: 'failed', failedReason: String(result.reason || '').slice(0, 300) } });
    const now = await Payment.findById(payment._id);
    return now && now.status === 'paid' ? 'paid' : 'failed';
  }
  // The gateway must have taken exactly what we asked for, for this payment
  const sameAmount = Math.abs(Number(result.amount) - payment.amount) < 0.01;
  if (!sameAmount || (result.currency && result.currency !== 'BDT') || (result.invoice && result.invoice !== payment.invoice)) {
    console.error(`[PAYMENTS] ${payment.invoice} does not match the gateway's record (amount ${result.amount} ${result.currency}, invoice ${result.invoice})`);
    await Payment.updateOne({ _id: payment._id, status: 'started' }, { $set: { status: 'failed', failedReason: 'The amount or invoice did not match' } });
    return 'failed';
  }
  const paid = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['started', 'failed', 'cancelled'] } },
    { $set: { status: 'paid', trxId: result.trxId || '', valId: result.valId || '', flagged: Boolean(result.risky), paidAt: new Date(), failedReason: '' } },
    { new: true }
  );
  if (!paid) {
    const now = await Payment.findById(payment._id);
    return now && ['refunding', 'refunded', 'refund_failed'].includes(now.status) ? 'refunded' : 'paid';
  }
  let placed;
  try {
    placed = await PURPOSES[paid.purpose]()(paid);
  } catch (err) {
    console.error(`[PAYMENTS] Could not place what ${paid.invoice} paid for:`, err.message);
    placed = { ok: false, reason: err.isOperational ? err.message : 'It could not be completed' };
  }
  if (!placed.ok) {
    await Payment.updateOne({ _id: paid._id }, { $set: { failedReason: String(placed.reason || '').slice(0, 300) } });
    await refund(paid, { reason: placed.reason || 'It could not be completed' });
    return 'refunded';
  }
  return 'paid';
};

module.exports = { GATEWAY_NAMES, newInvoice, baseUrl, open, refund, settle };
