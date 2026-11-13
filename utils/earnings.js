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
 */
const earningsFor = async agencyId => {
  const agency = oid(agencyId);
  const group = { _id: null, amount: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' }, plejarPays: { $sum: '$plejarPays' }, count: { $sum: 1 } };

  const now = new Date();
  const stayCoupons = { agency, status: 'accepted', couponFundedBy: 'plejar', discountAmount: { $gt: 0 } };
  const stayGroup = { _id: null, amount: { $sum: '$discountAmount' }, count: { $sum: 1 } };
  const stayCommission = { agency, status: 'accepted', commissionAmount: { $gt: 0 } };
  const commissionGroup = { _id: null, amount: { $sum: '$commissionAmount' }, count: { $sum: 1 } };
  const [done, upcoming, payouts, staysDone, staysAhead, owedDone, owedAhead] = await Promise.all([
    Booking.aggregate([{ $match: { agency, status: 'completed', paymentStatus: { $in: PAID } } }, { $group: group }]),
    Booking.aggregate([{ $match: { agency, status: 'confirmed', paymentStatus: { $in: PAID } } }, { $group: group }]),
    Payout.aggregate([{ $match: { agency } }, { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    StayRequest.aggregate([{ $match: { ...stayCoupons, checkOut: { $lte: now } } }, { $group: stayGroup }]),
    StayRequest.aggregate([{ $match: { ...stayCoupons, checkOut: { $gt: now } } }, { $group: stayGroup }]),
    StayRequest.aggregate([{ $match: { ...stayCommission, checkOut: { $lte: now } } }, { $group: commissionGroup }]),
    StayRequest.aggregate([{ $match: { ...stayCommission, checkOut: { $gt: now } } }, { $group: commissionGroup }])
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
  const earnedNet = d.amount - d.commission + (d.plejarPays || 0) + sd.amount - od.amount;

  return {
    completedTrips: d.count,
    gross: round(d.amount),
    commission: round(d.commission + od.amount),
    // Of that, commission on stays the guest paid the hotel for, which the hotel owes Plejar
    stayCommission: round(od.amount),
    earned: round(earnedNet),
    upcoming: round(u.amount - u.commission + (u.plejarPays || 0) + sa.amount - oa.amount),
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

  const rows = await Booking.aggregate([
    { $match: { agency: oid(agencyId), status: 'completed', paymentStatus: { $in: PAID }, completedAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$completedAt', timezone: 'Asia/Dhaka' } }, gross: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' }, plejarPays: { $sum: '$plejarPays' }, trips: { $sum: 1 } } }
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
