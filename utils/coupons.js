const mongoose = require('mongoose');
const { Coupon, CouponRedemption } = require('../models/couponModel');
const AppError = require('./appError');

/**
 * Using coupons on bookings and stay requests: which coupons fit, what they take off, and claiming
 * and giving back a use. See models/couponModel.js for who pays for each coupon.
 *
 * Where a coupon is used (ctx): { user, kind: 'tour'|'guide'|'hotel', vendor (the agency or hotel
 * account, if any), packageId (tours), subtotal (taka before the discount) }
 */

const WHAT = { tour: 'tours', guide: 'guide bookings', hotel: 'hotel stays' };
const taka = n => `৳${Math.round(n || 0).toLocaleString('en-US')}`;
const same = (a, b) => Boolean(a && b) && String(a._id || a) === String(b._id || b);

const normalizeCode = raw => String(raw || '').trim().toUpperCase().replace(/\s+/g, '');

// Coupons that can be used right now (on, not stopped by Plejar, in their dates, uses left)
const liveFilter = (now = new Date()) => ({
  status: 'active',
  blockedByAdmin: { $ne: true },
  $and: [
    { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
    { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    { $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] }
  ]
});

/** Taka a coupon takes off a subtotal (whole taka, never more than the subtotal) */
const discountFor = (coupon, subtotal) => {
  let off = coupon.discountType === 'percent' ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.discountType === 'percent' && coupon.maxDiscount) off = Math.min(off, coupon.maxDiscount);
  return Math.max(0, Math.round(Math.min(off, subtotal)));
};

// "20% off (up to ৳1,000)" or "৳500 off"
const offerLabel = c => (c.discountType === 'percent'
  ? `${c.value}% off${c.maxDiscount ? ` (up to ${taka(c.maxDiscount)})` : ''}`
  : `${taka(c.value)} off`);

/** Whether a coupon fits this booking at all (not counting dates, uses or minimum spend) */
const fits = (coupon, ctx) => {
  if (!coupon.appliesTo.includes(ctx.kind)) return false;
  if (coupon.vendor && !same(coupon.vendor, ctx.vendor)) return false;
  if (coupon.packages && coupon.packages.length) {
    if (ctx.kind !== 'tour' || !coupon.packages.some(p => same(p, ctx.packageId))) return false;
  }
  return true;
};

const usesBy = (couponId, userId) => CouponRedemption.countDocuments({ coupon: couponId, user: userId, status: 'applied' });

/** Why this coupon can't be used here, as a message for the traveler; null when it can */
const whyNot = async (coupon, ctx, now = new Date()) => {
  if (!coupon || coupon.status !== 'active' || coupon.blockedByAdmin) return "This coupon code isn't valid.";
  if (coupon.startsAt && coupon.startsAt > now) return `This coupon can be used from ${coupon.startsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Asia/Dhaka' })}.`;
  if (coupon.endsAt && coupon.endsAt < now) return 'This coupon has expired.';
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return 'This coupon has been fully used.';
  if (!coupon.appliesTo.includes(ctx.kind)) {
    return `This coupon is for ${coupon.appliesTo.map(k => WHAT[k]).join(' and ')} only.`;
  }
  if (!fits(coupon, ctx)) return coupon.fundedBy === 'vendor' ? "This coupon is for another agency's or hotel's bookings." : "This coupon can't be used on this booking.";
  if (coupon.minSpend && ctx.subtotal < coupon.minSpend) return `This coupon needs a booking of at least ${taka(coupon.minSpend)}.`;
  if (ctx.user && (await usesBy(coupon._id, ctx.user)) >= coupon.perUserLimit) {
    return coupon.perUserLimit === 1 ? 'You already used this coupon.' : `You can use this coupon ${coupon.perUserLimit} times, and you already have.`;
  }
  return null;
};

/** Check a code for a booking without using it: { coupon, discount } or an AppError (400) */
const checkCoupon = async (rawCode, ctx) => {
  const code = normalizeCode(rawCode);
  if (!code) throw new AppError('Enter a coupon code.', 400);
  const coupon = await Coupon.findOne({ code });
  const problem = await whyNot(coupon, ctx);
  if (problem) throw new AppError(problem, 400);
  const discount = discountFor(coupon, ctx.subtotal);
  if (discount <= 0) throw new AppError("This coupon doesn't take anything off this booking.", 400);
  return { coupon, discount };
};

/**
 * Give back coupon uses: filter picks redemptions, e.g. { booking: id }, { stayRequest: id },
 * { booking: { $in: ids } } or { _id: id }. Only uses still applied are given back, once each.
 */
const releaseCoupon = async filter => {
  const rows = await CouponRedemption.find({ ...filter, status: 'applied' }).select('_id coupon').lean();
  const done = await Promise.all(rows.map(async r => {
    const changed = await CouponRedemption.updateOne({ _id: r._id, status: 'applied' }, { status: 'released', releasedAt: new Date() });
    if (!changed.modifiedCount) return 0;
    await Coupon.updateOne({ _id: r.coupon, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    return 1;
  }));
  return done.reduce((n, x) => n + x, 0);
};

/**
 * Use a coupon: checks it, takes one of its uses (so the last use can't go to two travelers) and
 * records the redemption. Returns { coupon, discount, redemption }. Give it back with releaseCoupon
 * if the booking then fails, or is cancelled, declined or expires.
 */
const claimCoupon = async (rawCode, ctx) => {
  const { coupon, discount } = await checkCoupon(rawCode, ctx);
  const taken = await Coupon.findOneAndUpdate({ _id: coupon._id, ...liveFilter() }, { $inc: { usedCount: 1 } }, { new: true });
  if (!taken) throw new AppError('This coupon has just been fully used.', 400);
  const redemption = await CouponRedemption.create({
    coupon: coupon._id,
    code: coupon.code,
    user: ctx.user,
    kind: ctx.kind,
    vendor: ctx.vendor || undefined,
    fundedBy: coupon.fundedBy,
    subtotal: ctx.subtotal,
    discount
  });
  // Two uses by the same traveler at the same moment: keep the first
  const mine = await CouponRedemption.find({ coupon: coupon._id, user: ctx.user, status: 'applied' }).sort({ _id: 1 }).select('_id').lean();
  if (mine.findIndex(r => same(r._id, redemption._id)) >= coupon.perUserLimit) {
    await releaseCoupon({ _id: redemption._id });
    throw new AppError('You already used this coupon.', 400);
  }
  return { coupon: taken, discount, redemption };
};

/** A coupon as the app shows it */
const couponCard = (c, subtotal) => ({
  _id: c._id,
  code: c.code,
  title: c.title,
  description: c.description,
  discountType: c.discountType,
  value: c.value,
  maxDiscount: c.maxDiscount,
  minSpend: c.minSpend,
  label: offerLabel(c),
  endsAt: c.endsAt,
  // From Plejar or from the agency or hotel itself
  from: c.fundedBy === 'plejar' ? 'plejar' : 'vendor',
  discount: subtotal ? discountFor(c, subtotal) : null
});

/** Coupons shown on a booking screen: visible, live, fitting, and not used up by this traveler */
const availableCoupons = async ctx => {
  const or = [{ vendor: null }, { vendor: { $exists: false } }];
  if (ctx.vendor) or.push({ vendor: new mongoose.Types.ObjectId(String(ctx.vendor._id || ctx.vendor)) });
  const rows = await Coupon.find({ ...liveFilter(), visible: true, appliesTo: ctx.kind, $or: or }).sort({ fundedBy: 1, createdAt: -1 }).limit(50);
  const fitting = rows.filter(c => fits(c, ctx));
  const used = ctx.user ? await Promise.all(fitting.map(c => usesBy(c._id, ctx.user))) : fitting.map(() => 0);
  return fitting.filter((c, i) => used[i] < c.perUserLimit).map(c => couponCard(c, ctx.subtotal));
};

module.exports = { normalizeCode, liveFilter, discountFor, offerLabel, checkCoupon, claimCoupon, releaseCoupon, availableCoupons, couponCard };
