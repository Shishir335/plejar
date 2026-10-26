const crypto = require('crypto');
const { Voucher, UserVoucher } = require('../models/voucherModel');
const AppError = require('./appError');

// Shared voucher helpers: how a voucher looks on a card, when a redeemed one expires,
// and using one on a booking

const CATEGORY_LABELS = {
  hotel: 'Hotel', tour: 'Tour', guide: 'Guide', flight: 'Flight', airport: 'Airport', transport: 'Transport', restaurant: 'Restaurant'
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "August 15-20, 2025", "Aug 28 - Sep 3, 2025" style, or "Until December 31, 2025"
const dateRange = (from, until) => {
  const a = from && new Date(from);
  const b = until && new Date(until);
  if (!a && !b) return '';
  if (!a) return `Until ${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  if (!b) return `From ${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}, ${a.getUTCFullYear()}`;
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
    return `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}-${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  }
  const short = d => `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
  return a.getUTCFullYear() === b.getUTCFullYear()
    ? `${short(a)} - ${short(b)}, ${b.getUTCFullYear()}`
    : `${short(a)}, ${a.getUTCFullYear()} - ${short(b)}, ${b.getUTCFullYear()}`;
};

// The badge on the card: "25% OFF", "৳500 OFF" or "Free"
const discountLabel = d => {
  if (!d || d.type === 'free') return 'Free';
  if (d.type === 'amount') return `৳${Number(d.value || 0).toLocaleString('en-US')} OFF`;
  return `${d.value}% OFF`;
};

const soldOut = v => typeof v.stock === 'number' && v.redeemedCount >= v.stock;
// The end of the day a voucher can last be used (dates are stored as midnight UTC)
const endOfDay = d => new Date(new Date(d).getTime() + 86400000 - 1);
const isOver = v => Boolean(v.usableUntil) && endOfDay(v.usableUntil) < new Date();

/** When a voucher redeemed now stops working: its own end date, or validDays from today */
const expiryFor = v => {
  const byDays = new Date(Date.now() + (v.validDays || 90) * 86400000);
  if (!v.usableUntil) return byDays;
  const last = endOfDay(v.usableUntil);
  return v.validDays && byDays < last ? byDays : last;
};

/** A voucher as the app's cards show it; `balance` is the traveler's points, when known */
const voucherCard = (v, { balance = null, mine = 0 } = {}) => ({
  _id: v._id,
  title: v.title,
  description: v.description,
  category: v.category,
  categoryLabel: CATEGORY_LABELS[v.category] || v.category,
  image: v.image || '',
  badge: discountLabel(v.discount),
  discount: { type: v.discount.type, value: v.discount.value, maxAmount: v.discount.maxAmount },
  pointsCost: v.pointsCost,
  location: v.locationLabel || '',
  usableFrom: v.usableFrom || null,
  usableUntil: v.usableUntil || null,
  dates: dateRange(v.usableFrom, v.usableUntil),
  minSpend: v.minSpend || 0,
  usableOnBookings: Voucher.BOOKABLE.includes(v.category),
  soldOut: soldOut(v),
  left: typeof v.stock === 'number' ? Math.max(v.stock - v.redeemedCount, 0) : null,
  redeemedByMe: mine,
  limitReached: mine >= (v.perUserLimit || 1),
  ...(balance === null ? {} : { canAfford: balance >= v.pointsCost, pointsShort: Math.max(v.pointsCost - balance, 0) })
});

/** Why this traveler can't redeem the voucher right now, or null */
const redeemProblem = (v, { balance, mine }) => {
  if (!v.active) return 'This voucher is no longer offered.';
  if (isOver(v)) return 'This voucher has ended.';
  if (soldOut(v)) return 'This voucher is sold out.';
  if (mine >= (v.perUserLimit || 1)) return v.perUserLimit > 1 ? `You can redeem this voucher ${v.perUserLimit} times, and you already have.` : 'You already redeemed this voucher.';
  if (balance < v.pointsCost) return `You need ${(v.pointsCost - balance).toLocaleString('en-US')} more points.`;
  return null;
};

/** A personal code, e.g. WEEKEND25-7K3Q (letters that can't be confused with digits) */
const personalCode = async v => {
  const prefix = (v.code || v.category).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'PLEZAR';
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 5; i += 1) {
    const tail = Array.from(crypto.randomBytes(4), b => letters[b % letters.length]).join('');
    const code = `${prefix}-${tail}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await UserVoucher.exists({ code }))) return code;
  }
  throw new AppError("Couldn't make a voucher code. Try again.", 500);
};

/** Mark the traveler's redeemed vouchers that ran out as expired (done lazily when listed) */
const expireOld = userId => UserVoucher.updateMany({ user: userId, status: 'active', expiresAt: { $lt: new Date() } }, { status: 'expired' });

// Taka off a booking of `subtotal`
const discountFor = (v, subtotal) => {
  let off = 0;
  if (v.discount.type === 'percent') off = (subtotal * (v.discount.value || 0)) / 100;
  else if (v.discount.type === 'amount') off = v.discount.value || 0;
  else off = subtotal; // "Free": the whole booking, up to the cap
  if (v.discount.maxAmount) off = Math.min(off, v.discount.maxAmount);
  return Math.round(Math.min(off, subtotal));
};

/**
 * Use a redeemed voucher (its personal code) on a new booking: checks it fits, then claims it so it
 * can't be used twice. Returns { userVoucher, discount }. Call releaseVoucher if the booking then fails.
 */
const claimVoucher = async (userId, rawCode, kind, subtotal) => {
  const code = String(rawCode || '').trim().toUpperCase();
  const uv = await UserVoucher.findOne({ user: userId, code }).populate('voucher');
  if (!uv || !uv.voucher) throw new AppError("This voucher code isn't in your vouchers. Redeem it in Vouchers & Rewards first.", 400);
  if (uv.status === 'used') throw new AppError('You already used this voucher.', 400);
  if (uv.status === 'expired' || (uv.expiresAt && uv.expiresAt < new Date())) throw new AppError('This voucher has expired.', 400);
  const v = uv.voucher;
  if (v.category !== kind) throw new AppError(`This is a ${(CATEGORY_LABELS[v.category] || v.category).toLowerCase()} voucher. Use it on a ${(CATEGORY_LABELS[v.category] || v.category).toLowerCase()} booking.`, 400);
  if (v.usableFrom && new Date(v.usableFrom) > new Date()) throw new AppError(`This voucher can be used from ${dateRange(v.usableFrom, null).replace('From ', '')}.`, 400);
  if (v.minSpend && subtotal < v.minSpend) throw new AppError(`This voucher needs a booking of at least ৳${v.minSpend.toLocaleString('en-US')}.`, 400);
  const discount = discountFor(v, subtotal);
  const claimed = await UserVoucher.findOneAndUpdate({ _id: uv._id, status: 'active' }, { status: 'used', usedAt: new Date(), discountGiven: discount }, { new: true });
  if (!claimed) throw new AppError('You already used this voucher.', 400);
  return { userVoucher: claimed, discount };
};

/** Give a voucher back (the booking failed or the traveler cancelled it) */
const releaseVoucher = async userVoucherId => {
  const uv = await UserVoucher.findById(userVoucherId);
  if (!uv || uv.status !== 'used') return;
  uv.status = uv.expiresAt && uv.expiresAt < new Date() ? 'expired' : 'active';
  uv.usedAt = undefined;
  uv.booking = undefined;
  uv.discountGiven = 0;
  await uv.save();
};

module.exports = { CATEGORY_LABELS, dateRange, discountLabel, voucherCard, redeemProblem, expiryFor, personalCode, expireOld, discountFor, claimVoucher, releaseVoucher, isOver, soldOut };
