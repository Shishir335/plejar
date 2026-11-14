/**
 * Paying for an ad. The master admin sets a price per day (0 keeps ads free); a vendor pays
 * days x price when applying, through bKash or SSLCommerz, and the ad joins the review queue once
 * the gateway confirms the money. A rejected ad keeps its payment so it can be fixed and sent
 * again; withdrawing an ad that hasn't run refunds it. Stopping a running ad doesn't.
 */
const Payment = require('../models/paymentModel');
const Promotion = require('../models/promotionModel');
const AppError = require('./appError');
const { getSetting, setSetting } = require('./settings');
const { logActivity } = require('./activity');
const config = require('./payments/config');
const ledger = require('./payments/ledger');

const PRICE_KEY = 'adPricePerDay';
const MAX_PRICE = 100000;
const { GATEWAY_NAMES } = ledger;

const pricePerDay = async () => Math.max(0, Math.round(Number(await getSetting(PRICE_KEY, 0)) || 0));
const setPricePerDay = (value, userId) => setSetting(PRICE_KEY, value, userId);

// Calendar days in Bangladesh time
const bdDay = d => new Date(new Date(d).getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10);

/** Days the ad runs: from its start day (or today, if it starts when accepted) to its end day, both counted */
const adDays = (ad, now = new Date()) => {
  const from = ad.startsAt ? bdDay(ad.startsAt) : bdDay(now);
  const to = ad.endsAt ? bdDay(ad.endsAt) : from;
  return Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
};

/** What the ad costs now: { pricePerDay, days, amount } */
const quote = async ad => {
  const price = await pricePerDay();
  const days = adDays(ad);
  return { pricePerDay: price, days, amount: price * days };
};

/** What a vendor needs to know before paying */
const pricing = async () => ({ pricePerDay: await pricePerDay(), methods: config.enabledMethods(), sandbox: !config.isLive() });

/**
 * Open a payment for an unpaid ad. Returns { redirectUrl } to send the vendor to, or { free: true }
 * when ads cost nothing right now.
 */
const startAdPayment = async (req, ad, method) => {
  if (!config.enabledMethods().includes(method)) throw new AppError('Choose bKash or SSLCommerz to pay.', 400);
  const q = await quote(ad);
  if (!q.amount) return { free: true, quote: q };
  const agency = req.agency || {};
  const payment = await Payment.create({
    purpose: 'ad',
    promotion: ad._id,
    agency: ad.agency,
    user: req.user._id,
    description: `Ad: ${ad.title}`.slice(0, 200),
    amount: q.amount,
    days: q.days,
    pricePerDay: q.pricePerDay,
    method,
    invoice: ledger.newInvoice('PLJAD'),
    sandbox: !config.isLive()
  });
  const redirectUrl = await ledger.open(req, payment, {
    customer: { name: agency.name || req.user.name, email: req.user.email || agency.email, phone: agency.phone || req.user.phone },
    product: `Plejar ad: ${ad.title}`
  });
  await logActivity(req, { action: 'ad.payment_started', summary: `Started paying ${payment.amount} BDT by ${GATEWAY_NAMES[method]} for an ad: ${ad.title}`, agency: ad.agency });
  return { redirectUrl, quote: q };
};

/** Once the gateway confirms the money, the ad joins the review queue (see utils/payments/ledger.js) */
const onPaid = async paid => {
  const ad = await Promotion.findOneAndUpdate(
    { _id: paid.promotion, source: 'vendor', reviewStatus: 'unpaid' },
    { $set: { reviewStatus: 'pending', payment: paid._id } },
    { new: true }
  );
  // Paid twice (two tabs), or the ad was deleted while paying: the ledger gives this one back
  if (!ad) return { ok: false, reason: 'The ad was already paid for or was removed' };
  await logActivity(null, { action: 'ad.paid', summary: `Paid ${paid.amount} BDT by ${GATEWAY_NAMES[paid.method]} (${paid.trxId}) for an ad: ${ad.title}. Sent for review.`, agency: ad.agency, user: paid.user });
  return { ok: true };
};

/** The paid payment behind an ad, if any */
const paidPaymentFor = ad => (ad.payment ? Payment.findOne({ _id: ad.payment, status: 'paid' }) : null);

module.exports = {
  PRICE_KEY, MAX_PRICE, GATEWAY_NAMES,
  pricePerDay, setPricePerDay, adDays, quote, pricing,
  startAdPayment, onPaid, paidPaymentFor,
  settlePayment: ledger.settle, refundPayment: ledger.refund
};
