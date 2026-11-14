const mongoose = require('mongoose');
const Booking = require('../models/bookingModel');
const Payout = require('../models/payoutModel');
const StayRequest = require('../models/stayRequestModel');

const PAID = ['paid', 'partially_refunded'];
const round = n => Math.round((n || 0) * 100) / 100;
const oid = id => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id)));

const sums = rows => rows[0] || { amount: 0, commission: 0, plejarPays: 0, count: 0 };

/**
 * What a vendor has earned and what Plejar still owes it.
 * - earned: completed trips that were paid, minus Plejar's commission
 * - upcoming: confirmed, paid trips that have not happened yet (not yet withdrawable)
 * - available: earned, minus money already paid out and payouts waiting to be paid
 * Plejar's coupons are paid by Plejar: their discount (plejarPays) is added to the vendor's share.
 * Hotels are paid at the hotel, so for a hotel the only money Plejar owes is the discount from
 * Plejar's coupons on accepted stays: earned once the guest has checked out, upcoming before that.
 * When commission is on for a hotel, the hotel owes Plejar its commission on accepted stays the
 * same way, so it is taken off (and `earned` or `available` can go below zero: the hotel owes Plejar).
 * Booking money (utils/bookingMoney.js) is paid to Plejar online:
 * - tours the traveler pays the rest of to the agency: the booking money, minus Plejar's commission
 *   (with Plejar's coupon discount added), once the trip is completed; upcoming while confirmed
 * - accepted stays: the booking money, once the guest has checked out; upcoming before that
 * - kept on a cancellation (the traveler cancelled after it was confirmed): all of it, or what the
 *   cancellation refund left, straight away
 */
const earningsFor = async agencyId => {
  const agency = oid(agencyId);
  const group = { _id: null, amount: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' }, plejarPays: { $sum: '$plejarPays' }, count: { $sum: 1 } };

  const now = new Date();
  const stayCoupons = { agency, status: 'accepted', couponFundedBy: 'plejar', discountAmount: { $gt: 0 } };
  const stayGroup = { _id: null, amount: { $sum: '$discountAmount' }, count: { $sum: 1 } };
  const stayCommission = { agency, status: 'accepted', commissionAmount: { $gt: 0 } };
  const commissionGroup = { _id: null, amount: { $sum: '$commissionAmount' }, count: { $sum: 1 } };
  const depositGroup = { _id: null, amount: { $sum: '$depositAmount' }, commission: { $sum: '$commissionAmount' }, plejarPays: { $sum: '$plejarPays' }, count: { $sum: 1 } };
  const tourDeposits = { agency, paymentStatus: { $nin: PAID }, depositStatus: 'paid', depositAmount: { $gt: 0 } };
  const stayDeposits = { agency, status: 'accepted', depositStatus: 'paid', depositAmount: { $gt: 0 } };
  // Kept: all of it, or what a late cancellation's partial refund left (depositRefunded is what went back)
  const kept = {
    agency,
    depositAmount: { $gt: 0 },
    $or: [
      { depositStatus: 'kept' },
      { status: 'cancelled', depositStatus: { $in: ['refunding', 'refunded', 'refund_failed'] }, $expr: { $and: [{ $gt: ['$depositRefunded', 0] }, { $lt: ['$depositRefunded', '$depositAmount'] }] } }
    ]
  };
  const keptGroup = { _id: null, amount: { $sum: { $subtract: ['$depositAmount', { $ifNull: ['$depositRefunded', 0] }] } }, count: { $sum: 1 } };
  const [done, upcoming, payouts, staysDone, staysAhead, owedDone, owedAhead, depDone, depAhead, stayDepDone, stayDepAhead, keptTours, keptStays] = await Promise.all([
    Booking.aggregate([{ $match: { agency, status: 'completed', paymentStatus: { $in: PAID } } }, { $group: group }]),
    Booking.aggregate([{ $match: { agency, status: 'confirmed', paymentStatus: { $in: PAID } } }, { $group: group }]),
    Payout.aggregate([{ $match: { agency } }, { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    StayRequest.aggregate([{ $match: { ...stayCoupons, checkOut: { $lte: now } } }, { $group: stayGroup }]),
    StayRequest.aggregate([{ $match: { ...stayCoupons, checkOut: { $gt: now } } }, { $group: stayGroup }]),
    StayRequest.aggregate([{ $match: { ...stayCommission, checkOut: { $lte: now } } }, { $group: commissionGroup }]),
    StayRequest.aggregate([{ $match: { ...stayCommission, checkOut: { $gt: now } } }, { $group: commissionGroup }]),
    Booking.aggregate([{ $match: { ...tourDeposits, status: 'completed' } }, { $group: depositGroup }]),
    Booking.aggregate([{ $match: { ...tourDeposits, status: 'confirmed' } }, { $group: depositGroup }]),
    StayRequest.aggregate([{ $match: { ...stayDeposits, checkOut: { $lte: now } } }, { $group: depositGroup }]),
    StayRequest.aggregate([{ $match: { ...stayDeposits, checkOut: { $gt: now } } }, { $group: depositGroup }]),
    Booking.aggregate([{ $match: kept }, { $group: keptGroup }]),
    StayRequest.aggregate([{ $match: kept }, { $group: keptGroup }])
  ]);

  const d = sums(done);
  const u = sums(upcoming);
  const sd = staysDone[0] || { amount: 0, count: 0 };
  const sa = staysAhead[0] || { amount: 0, count: 0 };
  const od = owedDone[0] || { amount: 0, count: 0 };
  const oa = owedAhead[0] || { amount: 0, count: 0 };
  const byStatus = Object.fromEntries(payouts.map(p => [p._id, p]));
  const paidOut = (byStatus.paid || {}).amount || 0;
  const pending = (byStatus.pending || {}).amount || 0;
  const dd = sums(depDone);
  const da = sums(depAhead);
  const money = {
    earned: dd.amount - dd.commission + (dd.plejarPays || 0) + sums(stayDepDone).amount + sums(keptTours).amount + sums(keptStays).amount,
    upcoming: da.amount - da.commission + (da.plejarPays || 0) + sums(stayDepAhead).amount
  };
  const earnedNet = d.amount - d.commission + (d.plejarPays || 0) + sd.amount - od.amount + money.earned;

  return {
    completedTrips: d.count + dd.count,
    gross: round(d.amount),
    commission: round(d.commission + od.amount + dd.commission),
    // Of that, commission on stays the guest paid the hotel for, which the hotel owes Plejar
    stayCommission: round(od.amount),
    earned: round(earnedNet),
    upcoming: round(u.amount - u.commission + (u.plejarPays || 0) + sa.amount - oa.amount + money.upcoming),
    // Of earned and upcoming: booking money travelers paid online (after commission on tours)
    bookingMoney: { earned: round(money.earned), upcoming: round(money.upcoming) },
    // What Plejar's coupons added to the above (Plejar pays those discounts)
    plejarCoupons: round((d.plejarPays || 0) + sd.amount),
    upcomingTrips: u.count,
    paidOut: round(paidOut),
    pendingPayouts: round(pending),
    pendingPayoutCount: (byStatus.pending || {}).count || 0,
    available: round(earnedNet - paidOut - pending)
  };
};

// Net earnings per month for the last `months` months, by the month a trip was completed
const monthlyEarnings = async (agencyId, months = 6) => {
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1), 1);
  since.setHours(0, 0, 0, 0);

  // Paid trips count in full; trips paid at the agency count for the booking money Plejar took
  const rows = await Booking.aggregate([
    { $match: { agency: oid(agencyId), status: 'completed', completedAt: { $gte: since }, $or: [{ paymentStatus: { $in: PAID } }, { depositStatus: 'paid', depositAmount: { $gt: 0 } }] } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$completedAt', timezone: 'Asia/Dhaka' } }, gross: { $sum: { $cond: [{ $in: ['$paymentStatus', PAID] }, '$amount', '$depositAmount'] } }, commission: { $sum: '$commissionAmount' }, plejarPays: { $sum: '$plejarPays' }, trips: { $sum: 1 } } }
  ]);
  const map = new Map(rows.map(r => [r._id, r]));

  return Array.from({ length: months }, (_, i) => {
    const d = new Date(since);
    d.setMonth(since.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const r = map.get(key) || { gross: 0, commission: 0, plejarPays: 0, trips: 0 };
    return { month: key, trips: r.trips, gross: round(r.gross), commission: round(r.commission), net: round(r.gross - r.commission + (r.plejarPays || 0)) };
  });
};

module.exports = { earningsFor, monthlyEarnings, round, PAID };
