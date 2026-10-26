const mongoose = require('mongoose');
const PointsEntry = require('../models/pointsModel');
const Booking = require('../models/bookingModel');
const Review = require('../models/reviewModel');
const Destination = require('../models/destinationModel');
const { getSetting } = require('./settings');

// Loyalty points, travel status tiers and achievements ("Reward & Achievements" in the app)

// Travel status by total points earned (spending points on vouchers doesn't lower the tier)
const TIERS = [
  { key: 'explorer', name: 'Explorer', minPoints: 0 },
  { key: 'silver', name: 'Silver Member', minPoints: 2500 },
  { key: 'gold', name: 'Gold Member', minPoints: 5000 },
  { key: 'platinum', name: 'Platinum Member', minPoints: 10000 }
];

const pointsPerTaka = () => getSetting('pointsPerTaka', 1);

/** Points a completed booking earns: the amount paid times the points-per-taka setting */
const pointsFor = async booking => Math.max(0, Math.round((booking.amount || 0) * (await pointsPerTaka())));

/** Give the points for a completed booking, once. Returns the points given (0 if already given). */
const awardBookingPoints = async booking => {
  if (booking.pointsAwarded > 0 || await PointsEntry.exists({ booking: booking._id, kind: 'earned' })) return 0;
  const points = await pointsFor(booking);
  if (!points) return 0;
  await PointsEntry.create({ user: booking.user, points, kind: 'earned', reason: `Completed ${booking.packageTitle}`, booking: booking._id });
  booking.pointsAwarded = points;
  await Booking.updateOne({ _id: booking._id }, { pointsAwarded: points });
  return points;
};

/** Balance (what can be spent) and lifetime earned (what sets the tier) */
const pointsSummary = async userId => {
  const rows = await PointsEntry.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(userId)) } },
    { $group: { _id: null, balance: { $sum: '$points' }, earned: { $sum: { $cond: [{ $in: ['$kind', ['earned', 'bonus', 'adjusted', 'reversed']] }, '$points', 0] } } } }
  ]);
  const r = rows[0] || { balance: 0, earned: 0 };
  return { balance: Math.max(0, r.balance), earned: Math.max(0, r.earned) };
};

const tierFor = earned => {
  const index = TIERS.reduce((at, t, i) => (earned >= t.minPoints ? i : at), 0);
  const current = TIERS[index];
  const next = TIERS[index + 1] || null;
  const span = next ? next.minPoints - current.minPoints : 1;
  return {
    key: current.key,
    name: current.name,
    next: next ? { key: next.key, name: next.name, minPoints: next.minPoints, pointsToGo: next.minPoints - earned } : null,
    progressPercent: next ? Math.min(100, Math.round(((earned - current.minPoints) / span) * 100)) : 100
  };
};

// What each achievement counts, from the traveler's own history
const ACHIEVEMENTS = [
  { key: 'first_trip', name: 'First Steps', description: 'Complete your first trip', icon: 'flag', target: 1, measure: 'trips' },
  { key: 'silver_traveler', name: 'Silver Traveler', description: 'Complete 5 trips', icon: 'medal', target: 5, measure: 'trips' },
  { key: 'gold_trotter', name: 'Gold Trotter', description: 'Visit 3 divisions of Bangladesh', icon: 'globe', target: 3, measure: 'divisions' },
  { key: 'all_bangladesh', name: 'Shonar Bangla', description: 'Visit all 8 divisions', icon: 'map', target: 8, measure: 'divisions' },
  { key: 'night_owl', name: 'Night Owl', description: 'Book 10 hotel nights', icon: 'owl', target: 10, measure: 'hotelNights' },
  { key: 'storyteller', name: 'Storyteller', description: 'Write 5 reviews', icon: 'star', target: 5, measure: 'reviews' }
];

const travelStats = async userId => {
  const user = new mongoose.Types.ObjectId(String(userId));
  const [trips, nights, reviews, places] = await Promise.all([
    Booking.countDocuments({ user, status: 'completed' }),
    Booking.aggregate([{ $match: { user, kind: 'hotel', status: { $in: ['confirmed', 'completed'] } } }, { $group: { _id: null, n: { $sum: { $multiply: [{ $ifNull: ['$units', 1] }, { $ifNull: ['$rooms', 1] }] } } } }]),
    Review.countDocuments({ user }),
    Booking.distinct('destinationRef', { user, status: 'completed', destinationRef: { $ne: null } })
  ]);
  // A division is visited when a completed trip was somewhere inside it
  const dests = await Destination.find({ _id: { $in: places } }).select('type ancestors').populate('ancestors', 'type').lean();
  const divisions = new Set();
  dests.forEach(d => {
    if (d.type === 'region') divisions.add(String(d._id));
    (d.ancestors || []).filter(a => a && a.type === 'region').forEach(a => divisions.add(String(a._id)));
  });
  return { trips, hotelNights: nights[0] ? nights[0].n : 0, reviews, divisions: divisions.size };
};

const achievementsFor = stats => ACHIEVEMENTS.map(a => {
  const current = Math.min(stats[a.measure] || 0, a.target);
  return {
    key: a.key,
    name: a.name,
    description: a.description,
    icon: a.icon,
    current,
    target: a.target,
    percent: Math.round((current / a.target) * 100),
    achieved: current >= a.target
  };
});

module.exports = { TIERS, ACHIEVEMENTS, pointsPerTaka, pointsFor, awardBookingPoints, pointsSummary, tierFor, travelStats, achievementsFor };
