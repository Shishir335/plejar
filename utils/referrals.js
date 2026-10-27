const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/userModel');
const PointsEntry = require('../models/pointsModel');
const Notification = require('../models/notificationModel');
const { getSetting } = require('./settings');
const { roleFilter } = require('./roles');

// Refer Friends: each traveler's code, the welcome bonus for the friend who joins with it,
// and the reward for the traveler who invited them once that friend completes a first trip

const DEFAULTS = { referralReward: 1000, referralWelcomeBonus: 500 };
const referralReward = async () => Number(await getSetting('referralReward', DEFAULTS.referralReward)) || 0;
const welcomeBonus = async () => Number(await getSetting('referralWelcomeBonus', DEFAULTS.referralWelcomeBonus)) || 0;

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** The traveler's code (made the first time it's asked for), e.g. RAHIM7K3Q */
const ensureReferralCode = async user => {
  if (user.referralCode) return user.referralCode;
  const base = String(user.firstName || user.name || 'PLEJAR').normalize('NFKD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'PLEJAR';
  for (let i = 0; i < 6; i += 1) {
    const code = base + Array.from(crypto.randomBytes(4), b => LETTERS[b % LETTERS.length]).join('');
    // Set only if still empty, so two requests at once agree on one code
    // eslint-disable-next-line no-await-in-loop
    const saved = await User.findOneAndUpdate({ _id: user._id, referralCode: null }, { referralCode: code }, { new: true }).catch(err => {
      if (err.code === 11000) return null; // someone else has this code: try another
      throw err;
    });
    if (saved) return saved.referralCode;
    // eslint-disable-next-line no-await-in-loop
    const fresh = await User.findById(user._id).select('referralCode').lean();
    if (fresh && fresh.referralCode) return fresh.referralCode;
  }
  throw new Error("Couldn't make a referral code");
};

/** The active traveler a code belongs to, or null */
const findReferrer = code => {
  const clean = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(clean)) return null;
  return User.findOne({ $and: [{ referralCode: clean, status: 'active' }, roleFilter('user')] }).select('_id name firstName photo');
};

/** A new traveler joined with someone's code: remember who, and give the welcome bonus */
const applyReferral = async (user, referrer) => {
  if (!referrer || String(referrer._id) === String(user._id)) return 0;
  await User.updateOne({ _id: user._id }, { referredBy: referrer._id });
  user.referredBy = referrer._id;
  const bonus = await welcomeBonus();
  if (bonus > 0) await PointsEntry.create({ user: user._id, points: bonus, kind: 'bonus', reason: `Welcome bonus: invited by ${referrer.firstName || referrer.name}`, friend: referrer._id });
  return bonus;
};

/** A booking was completed: if it's the traveler's first and someone invited them, reward the inviter once */
const rewardReferrer = async booking => {
  try {
    const friend = await User.findOneAndUpdate(
      { _id: booking.user, referredBy: { $ne: null }, referralRewardedAt: null },
      { referralRewardedAt: new Date() },
      { new: true }
    ).select('referredBy name firstName');
    if (!friend) return 0;
    const points = await referralReward();
    if (points > 0) {
      await PointsEntry.create({ user: friend.referredBy, points, kind: 'bonus', reason: `${friend.firstName || friend.name} completed their first trip`, friend: friend._id, booking: booking._id });
      await Notification.create({
        user: friend.referredBy,
        kind: 'referral_reward',
        title: `You earned ${points.toLocaleString('en-US')} points`,
        body: `${friend.firstName || friend.name}, who joined with your code, completed their first trip.`
      });
    }
    return points;
  } catch (err) {
    console.warn('[REFERRAL WARNING]', err.message);
    return 0;
  }
};

/** Totals for "Track Your Referrals" */
const referralStats = async userId => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const [total, successful, earned] = await Promise.all([
    User.countDocuments({ referredBy: id }),
    User.countDocuments({ referredBy: id, referralRewardedAt: { $ne: null } }),
    PointsEntry.aggregate([{ $match: { user: id, kind: 'bonus', friend: { $ne: null }, booking: { $ne: null } } }, { $group: { _id: null, n: { $sum: '$points' } } }])
  ]);
  return { totalReferrals: total, successfulReferrals: successful, pendingReferrals: total - successful, pointsEarned: earned[0] ? earned[0].n : 0 };
};

module.exports = { DEFAULTS, referralReward, welcomeBonus, ensureReferralCode, findReferrer, applyReferral, rewardReferrer, referralStats };
