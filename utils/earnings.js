const mongoose = require('mongoose');
const Booking = require('../models/bookingModel');
const Payout = require('../models/payoutModel');

const PAID = ['paid', 'partially_refunded'];
const round = n => Math.round((n || 0) * 100) / 100;
const oid = id => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id)));

const sums = rows => rows[0] || { amount: 0, commission: 0, count: 0 };

/**
 * What a vendor has earned and what Plezar still owes it.
 * - earned: completed trips that were paid, minus Plezar's commission
 * - upcoming: confirmed, paid trips that have not happened yet (not yet withdrawable)
 * - available: earned, minus money already paid out and payouts waiting to be paid
 */
const earningsFor = async agencyId => {
  const agency = oid(agencyId);
  const group = { _id: null, amount: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' }, count: { $sum: 1 } };

  const [done, upcoming, payouts] = await Promise.all([
    Booking.aggregate([{ $match: { agency, status: 'completed', paymentStatus: { $in: PAID } } }, { $group: group }]),
    Booking.aggregate([{ $match: { agency, status: 'confirmed', paymentStatus: { $in: PAID } } }, { $group: group }]),
    Payout.aggregate([{ $match: { agency } }, { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } }])
  ]);

  const d = sums(done);
  const u = sums(upcoming);
  const byStatus = Object.fromEntries(payouts.map(p => [p._id, p]));
  const paidOut = (byStatus.paid || {}).amount || 0;
  const pending = (byStatus.pending || {}).amount || 0;
  const earnedNet = d.amount - d.commission;

  return {
    completedTrips: d.count,
    gross: round(d.amount),
    commission: round(d.commission),
    earned: round(earnedNet),
    upcoming: round(u.amount - u.commission),
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
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$completedAt', timezone: 'Asia/Dhaka' } }, gross: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' }, trips: { $sum: 1 } } }
  ]);
  const map = new Map(rows.map(r => [r._id, r]));

  return Array.from({ length: months }, (_, i) => {
    const d = new Date(since);
    d.setMonth(since.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const r = map.get(key) || { gross: 0, commission: 0, trips: 0 };
    return { month: key, trips: r.trips, gross: round(r.gross), commission: round(r.commission), net: round(r.gross - r.commission) };
  });
};

module.exports = { earningsFor, monthlyEarnings, round, PAID };
