const Booking = require('../models/bookingModel');
const { ID_KINDS, FACE_KINDS, ageOn, idOptions, canBook, verificationRequired } = require('../utils/identity');
const PointsEntry = require('../models/pointsModel');
const User = require('../models/userModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { passwordProblems } = require('../utils/registration');
const { sendVerifyCode, checkVerifyCode } = require('../utils/verifyCodes');
const { signToken } = require('./authController');
const { userCard } = require('../utils/social');
const { ensureReferralCode, findReferrer, referralReward, welcomeBonus, referralStats } = require('../utils/referrals');
const { bookingCards } = require('./bookingController');
const { TIERS, pointsSummary, tierFor, travelStats, achievementsFor } = require('../utils/rewards');

// The traveler's "My Account" pages that aren't bookings or settings: travel history, rewards,
// ID verification and the password change

/**
 * GET /me/travel-history?page — completed trips, newest first, with the points each one earned
 * and whether it still needs a review.
 */
exports.travelHistory = catchAsync(async (req, res) => {
  const filter = { user: req.user._id, status: 'completed' };
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const [rows, total] = await Promise.all([
    Booking.find(filter).sort({ travelDate: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Booking.countDocuments(filter)
  ]);
  res.status(200).json({ status: 'success', data: { trips: await bookingCards(rows), total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) } });
});

/**
 * GET /me/rewards — "Reward & Achievements": points balance, travel status (tier) with progress
 * to the next one, achievements in progress and done, and the latest points activity.
 */
exports.rewards = catchAsync(async (req, res) => {
  const [points, stats, recent] = await Promise.all([
    pointsSummary(req.user._id),
    travelStats(req.user._id),
    PointsEntry.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(10).select('points kind reason booking createdAt').lean()
  ]);
  const achievements = achievementsFor(stats);
  res.status(200).json({
    status: 'success',
    data: {
      points: { balance: points.balance, totalEarned: points.earned },
      status: tierFor(points.earned),
      tiers: TIERS,
      achievements: {
        inProgress: achievements.filter(a => !a.achieved),
        earned: achievements.filter(a => a.achieved)
      },
      stats,
      recentPoints: recent
    }
  });
});

// GET /me/points?page — every points entry (earned, spent, adjusted)
exports.pointsHistory = catchAsync(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const [rows, total, summary] = await Promise.all([
    PointsEntry.find({ user: req.user._id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('points kind reason booking createdAt').lean(),
    PointsEntry.countDocuments({ user: req.user._id }),
    pointsSummary(req.user._id)
  ]);
  res.status(200).json({ status: 'success', data: { balance: summary.balance, entries: rows, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) } });
});

// ---------- ID Verification: email, phone, ID document, selfie ----------

// A document step follows the admin's review of everything uploaded
const documentStep = (user, kinds) => {
  const v = user.verification || {};
  if (!(v.documents || []).some(d => kinds.includes(d.kind))) return v.status === 'rejected' ? 'rejected' : 'todo';
  return { approved: 'complete', rejected: 'rejected', pending: 'pending_review' }[v.status] || 'pending_review';
};

const contactStep = (value, verifiedAt) => {
  if (!value) return 'missing';
  return verifiedAt ? 'complete' : 'todo';
};

// The ID sent: 'nid' (front and back), 'birth_certificate', or an older upload
const idDocumentKind = docs => {
  const kinds = new Set(docs.map(d => d.kind));
  if (kinds.has('nid_front') || kinds.has('nid_back')) return 'nid';
  return ['birth_certificate', 'nid', 'passport', 'driving_license'].find(k => kinds.has(k)) || null;
};

const verificationSteps = user => {
  // Signing in with Google already proves the email address
  const emailVerifiedAt = user.emailVerifiedAt || (user.authProvider === 'google' && user.email ? user.createdAt || user._id.getTimestamp() : null);
  const v = user.verification || {};
  const docs = v.documents || [];
  const age = ageOn(user.dateOfBirth);
  const options = idOptions(age);
  const steps = [
    { key: 'email', title: 'Email Verification', value: user.email || null, status: contactStep(user.email, emailVerifiedAt), verifiedAt: emailVerifiedAt || null },
    { key: 'phone', title: 'Phone Verification', value: user.phone || null, status: contactStep(user.phone, user.phoneVerifiedAt), verifiedAt: user.phoneVerifiedAt || null },
    {
      key: 'id',
      title: 'ID Verification',
      documentKind: idDocumentKind(docs),
      status: documentStep(user, ID_KINDS),
      // What this traveler may send: NID from 18, birth certificate below 18 (empty until a date of birth is set)
      acceptedKinds: options,
      dateOfBirthRequired: age == null
    },
    {
      key: 'selfie',
      title: 'Face Verification',
      status: documentStep(user, FACE_KINDS),
      photos: FACE_KINDS.filter(k => docs.some(d => d.kind === k)).length
    }
  ];
  const done = steps.filter(s => s.status === 'complete').length;
  return {
    status: v.status || 'none', // the admin's decision on the documents: none, pending, approved, rejected
    verified: done === steps.length,
    note: v.note || '',
    completedSteps: done,
    totalSteps: steps.length,
    nextStep: (steps.find(s => s.status !== 'complete' && s.status !== 'pending_review') || {}).key || null,
    // Booking needs only the admin's approval of the ID and face photos
    canBook: canBook(user),
    verificationRequired: verificationRequired(),
    age,
    idOptions: options,
    submittedAt: v.submittedAt || null,
    reviewedAt: v.reviewedAt || null,
    steps
  };
};
exports.verificationSteps = verificationSteps;

// GET /me/verification — the four steps and where each one stands
exports.verification = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: { verification: verificationSteps(req.user) } });
});

const contactChannel = req => (req.params.channel === 'phone' ? 'phone' : 'email');

// POST /me/verification/:channel/send — a 4-digit code to the email or phone on the profile
exports.sendContactCode = catchAsync(async (req, res, next) => {
  const channel = contactChannel(req);
  const user = await User.findById(req.user._id);
  if (channel === 'email' && verificationSteps(user).steps[0].status === 'complete') return next(new AppError('Your email is already verified.', 400));
  if (channel === 'phone' && user.phoneVerifiedAt) return next(new AppError('Your mobile number is already verified.', 400));
  const sent = await sendVerifyCode(user, channel, req);
  res.status(200).json({ status: 'success', message: `We sent a code to ${sent.sentTo}.`, data: sent });
});

// POST /me/verification/:channel/confirm { code }
exports.confirmContactCode = catchAsync(async (req, res) => {
  const channel = contactChannel(req);
  const user = await User.findById(req.user._id);
  await checkVerifyCode(user, channel, req.body.code);
  user[channel === 'email' ? 'emailVerifiedAt' : 'phoneVerifiedAt'] = new Date();
  await user.save({ validateBeforeSave: false });
  res.status(200).json({
    status: 'success',
    message: channel === 'email' ? 'Your email is verified.' : 'Your mobile number is verified.',
    data: { verification: verificationSteps(user) }
  });
});

// After POST /me/verification/documents (userController.submitMyVerification saved the files)
exports.documentsSaved = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id);
  res.status(200).json({
    status: 'success',
    message: 'Documents received. Plejar will review them and update your status.',
    data: { verification: verificationSteps(user) }
  });
});

// ---------- Password ----------

/**
 * PATCH /me/password { currentPassword, password, confirmPassword }
 * A wrong current password is a 400 field error (not 401), so the app keeps the traveler signed in.
 * Returns a new token: older ones stop working after a password change.
 */
exports.changePassword = catchAsync(async (req, res) => {
  const b = req.body;
  const user = await User.findById(req.user._id).select('+password');
  const errors = {};
  if (!user.password) errors.currentPassword = 'Your account signs in with Google, so it has no password to change.';
  else if (!String(b.currentPassword || '')) errors.currentPassword = 'Enter your current password.';
  else if (!(await user.correctPassword(String(b.currentPassword), user.password))) errors.currentPassword = 'Your current password is wrong.';
  passwordProblems(b, errors);
  if (!errors.password && !errors.currentPassword && String(b.password) === String(b.currentPassword)) errors.password = 'Choose a password different from your current one.';
  if (Object.keys(errors).length) return res.status(400).json({ status: 'fail', message: Object.values(errors)[0], errors });
  user.password = b.password;
  user.confirmPassword = b.confirmPassword;
  await user.save();
  res.status(200).json({ status: 'success', message: 'Your password was changed.', token: signToken(user._id) });
});

// ---------- Refer Friends ----------

/**
 * GET /me/referrals — the traveler's code and link, ready-made share text and links
 * (Email, Twitter, Messenger, WhatsApp), how it works, totals and the friends who joined.
 */
exports.referrals = catchAsync(async (req, res) => {
  const code = await ensureReferralCode(req.user);
  const site = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const link = `${site}/refer?code=${code}`;
  const [reward, bonus, stats, friends] = await Promise.all([
    referralReward(),
    welcomeBonus(),
    referralStats(req.user._id),
    User.find({ referredBy: req.user._id }).sort({ createdAt: -1 }).limit(50).select('name firstName lastName photo verification.status createdAt referralRewardedAt').lean()
  ]);
  const text = `Join me on Plejar and get ${bonus.toLocaleString('en-US')} points to start! Use my code ${code} when you sign up: ${link}`;
  const enc = encodeURIComponent;
  res.status(200).json({
    status: 'success',
    data: {
      code,
      link,
      shareText: text,
      share: {
        email: `mailto:?subject=${enc('Join me on Plejar')}&body=${enc(text)}`,
        twitter: `https://twitter.com/intent/tweet?text=${enc(text)}`,
        messenger: `fb-messenger://share/?link=${enc(link)}`,
        whatsapp: `https://wa.me/?text=${enc(text)}`
      },
      reward: { perReferral: reward, friendWelcomeBonus: bonus },
      howItWorks: [
        { step: 1, title: 'Share your code', text: 'Send your referral code or link to friends.' },
        { step: 2, title: 'Friend signs up', text: `Your friend joins Plejar with your code and gets ${bonus.toLocaleString('en-US')} welcome points.` },
        { step: 3, title: 'You earn points', text: `You get ${reward.toLocaleString('en-US')} points when they complete their first trip.` }
      ],
      stats,
      friends: friends.map(f => ({
        ...userCard(f),
        joinedAt: f.createdAt,
        status: f.referralRewardedAt ? 'successful' : 'pending',
        pointsEarned: f.referralRewardedAt ? reward : 0,
        rewardedAt: f.referralRewardedAt || null
      }))
    }
  });
});

// GET /auth/referral/:code — is this code real? (the sign-up form checks it as it's typed)
exports.checkReferralCode = catchAsync(async (req, res) => {
  const referrer = await findReferrer(req.params.code);
  if (!referrer) return res.status(404).json({ status: 'fail', message: "This referral code doesn't exist.", errors: { referralCode: "This referral code doesn't exist." } });
  res.status(200).json({ status: 'success', data: { valid: true, invitedBy: referrer.firstName || referrer.name, welcomeBonus: await welcomeBonus() } });
});
