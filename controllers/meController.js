const path = require('path');
const validator = require('validator');
const User = require('../models/userModel');
const Post = require('../models/postModel');
const SavedPost = require('../models/savedPostModel');
const Block = require('../models/blockModel');
const Follow = require('../models/followModel');
const Agency = require('../models/agencyModel');
const Booking = require('../models/bookingModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { roleFilter } = require('../utils/roles');
const { saveProfileImage, removeProfileImage } = require('../utils/userImages');
const { readPersonName, readDateOfBirth, normalizePhone } = require('../utils/registration');
const { viewerContext, userCard, POPULATE, hydratePosts, pageSize, cursorFilter, nextCursor } = require('../utils/social');

// The Settings tab: your profile, privacy and notification choices, saved posts, people you blocked

const profileView = async user => {
  const [followers, following, posts, trips] = await Promise.all([
    Follow.countDocuments({ targetType: 'user', target: user._id }),
    Follow.countDocuments({ follower: user._id }),
    Post.countDocuments({ author: user._id, status: 'active' }),
    Booking.countDocuments({ user: user._id, status: 'completed' })
  ]);
  return {
    ...userCard(user),
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
    email: user.email,
    phone: user.phone,
    emailVerified: Boolean(user.emailVerifiedAt || (user.authProvider === 'google' && user.email)),
    phoneVerified: Boolean(user.phone && user.phoneVerifiedAt),
    gender: user.gender || '',
    address: user.address || '',
    occupation: user.occupation || '',
    bio: user.bio,
    hometown: user.hometown,
    coverPhoto: user.coverPhoto,
    authProvider: user.authProvider,
    verification: (user.verification && user.verification.status) || 'none',
    counts: { followers, following, posts, trips },
    joinedAt: user._id.getTimestamp()
  };
};

exports.getProfile = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: { profile: await profileView(req.user) } });
});

const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'];

/**
 * PATCH /me/profile (multipart: photo, cover) firstName, lastName, dateOfBirth, gender, address, occupation,
 * email, phone, bio, hometown (name still works). A new email or phone has to be verified again.
 */
exports.updateProfile = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  const b = req.body;
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (name.length < 2 || name.length > 60) return next(new AppError('Your name should be 2 to 60 characters.', 400));
    user.name = name;
  }
  if (b.firstName !== undefined) user.firstName = readPersonName(b.firstName, 'first name');
  if (b.lastName !== undefined) user.lastName = readPersonName(b.lastName, 'last name');
  if (b.dateOfBirth !== undefined) user.dateOfBirth = readDateOfBirth(b.dateOfBirth);
  if (b.bio !== undefined) user.bio = String(b.bio).trim().slice(0, 300);
  if (b.hometown !== undefined) user.hometown = String(b.hometown).trim().slice(0, 80);
  if (b.gender !== undefined) {
    if (b.gender && !GENDERS.includes(b.gender)) return next(new AppError(`Choose a gender: ${GENDERS.join(', ')}.`, 400));
    user.gender = b.gender || '';
  }
  if (b.address !== undefined) user.address = String(b.address).trim().slice(0, 200);
  if (b.occupation !== undefined) user.occupation = String(b.occupation).trim().replace(/\s+/g, ' ').slice(0, 60);
  if (b.email !== undefined) {
    const email = String(b.email).trim().toLowerCase();
    if (!email && !user.phone) return next(new AppError('Keep an email address or a mobile number on your account.', 400));
    if (email && !validator.isEmail(email)) return next(new AppError('Enter a valid email address, for example rahim@gmail.com.', 400));
    if (email !== (user.email || '')) {
      if (user.authProvider === 'google') return next(new AppError('Your account signs in with Google, so its email can\'t be changed.', 400));
      if (email && await User.exists({ email, _id: { $ne: user._id } }).setOptions({ includeInactive: true })) return next(new AppError('Another account already uses this email.', 400));
      user.email = email || undefined;
      user.emailVerifiedAt = undefined;
    }
  }
  if (b.phone !== undefined) {
    const raw = String(b.phone).trim();
    const phone = raw ? normalizePhone(raw) : '';
    if (raw && !phone) return next(new AppError('Enter a Bangladeshi mobile number, for example 01712345678.', 400));
    if (!phone && !user.email) return next(new AppError('Keep an email address or a mobile number on your account.', 400));
    if (phone !== (user.phone || '')) {
      if (phone && await User.exists({ $and: [{ phone, _id: { $ne: user._id } }, roleFilter('user')] }).setOptions({ includeInactive: true })) return next(new AppError('Another account already uses this mobile number.', 400));
      user.phone = phone || undefined;
      user.phoneVerifiedAt = undefined;
    }
  }
  const files = req.files || {};
  const oldPhoto = user.photo;
  const oldCover = user.coverPhoto;
  if (files.photo && files.photo[0]) user.photo = await saveProfileImage(files.photo[0], user._id, 'user');
  if (files.cover && files.cover[0]) user.coverPhoto = `/img/users/${await saveProfileImage(files.cover[0], user._id, 'cover')}`;
  if (b.removeCover === 'true' || b.removeCover === true) user.coverPhoto = '';
  await user.save({ validateBeforeSave: false });
  if (user.photo !== oldPhoto) await removeProfileImage(oldPhoto);
  if (user.coverPhoto !== oldCover && oldCover) await removeProfileImage(path.basename(oldCover));
  res.status(200).json({ status: 'success', message: 'Profile saved.', data: { profile: await profileView(user) } });
});

const LANGUAGES = [{ code: 'en', label: 'English' }, { code: 'bn', label: 'Bangla' }];

// The Settings screen: the profile toggles, language, and the pages under "Others"
const settingsView = settings => ({
  settings,
  profile: {
    personalInformation: settings.privacy.showPersonalInfo !== false,
    address: Boolean(settings.privacy.showAddress)
  },
  language: { code: settings.language, label: (LANGUAGES.find(l => l.code === settings.language) || LANGUAGES[0]).label, options: LANGUAGES },
  others: [
    { key: 'about', label: 'About App', api: '/api/v1/pages/about' },
    { key: 'privacy', label: 'Privacy Policy', api: '/api/v1/pages/privacy' },
    { key: 'terms', label: 'Terms & Conditions', api: '/api/v1/pages/terms' }
  ]
});

exports.getSettings = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: settingsView(req.user.settings) });
});

/**
 * PATCH /me/settings { privacy: {...}, notifications: {...}, language }
 * The Settings screen's toggles: personalInformation (bio, hometown, occupation on your profile)
 * and address (your area and district on your profile) can be sent at the top level too.
 */
exports.updateSettings = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  const { privacy = {}, notifications = {}, language } = req.body;
  const pick = (value, allowed, label) => {
    if (value === undefined) return undefined;
    if (!allowed.includes(value)) throw new AppError(`Choose ${label}: ${allowed.join(', ')}.`, 400);
    return value;
  };
  const audience = pick(privacy.defaultAudience, ['public', 'followers', 'private'], 'who sees your posts');
  const comment = pick(privacy.whoCanComment, ['everyone', 'followers', 'nobody'], 'who can comment');
  if (audience) user.settings.privacy.defaultAudience = audience;
  if (comment) user.settings.privacy.whoCanComment = comment;
  if (privacy.showTrips !== undefined) user.settings.privacy.showTrips = Boolean(privacy.showTrips);
  const showInfo = privacy.showPersonalInfo !== undefined ? privacy.showPersonalInfo : req.body.personalInformation;
  const showAddress = privacy.showAddress !== undefined ? privacy.showAddress : req.body.address;
  if (showInfo !== undefined) user.settings.privacy.showPersonalInfo = showInfo === true || showInfo === 'true';
  if (showAddress !== undefined) user.settings.privacy.showAddress = showAddress === true || showAddress === 'true';
  ['reactions', 'comments', 'replies', 'shares', 'follows', 'tours'].forEach(k => {
    if (notifications[k] !== undefined) user.settings.notifications[k] = Boolean(notifications[k]);
  });
  if (language !== undefined) {
    if (!['en', 'bn'].includes(language)) return next(new AppError('Choose English (en) or Bangla (bn).', 400));
    user.settings.language = language;
  }
  await user.save({ validateBeforeSave: false });
  res.status(200).json({ status: 'success', message: 'Settings saved.', data: settingsView(user.settings) });
});

exports.savedPosts = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const limit = pageSize(req.query);
  const rows = await SavedPost.find({ user: req.user._id, ...cursorFilter(req.query.cursor) }).sort({ createdAt: -1, _id: -1 }).limit(limit)
    .populate({ path: 'post', populate: POPULATE });
  // Saved posts that were deleted or became private drop out
  const posts = await hydratePosts(rows.map(r => r.post).filter(p => p && p.status === 'active'), ctx);
  res.status(200).json({ status: 'success', data: { posts, nextCursor: nextCursor(rows, limit) } });
});

exports.blocked = catchAsync(async (req, res) => {
  const rows = await Block.find({ blocker: req.user._id }).sort({ createdAt: -1 }).populate('blocked', 'name photo verification.status').lean();
  res.status(200).json({ status: 'success', data: { people: rows.filter(r => r.blocked).map(r => ({ ...userCard(r.blocked), blockedAt: r.createdAt })) } });
});

// Agencies you follow (the Agents tab can show them first)
exports.followingAgencies = catchAsync(async (req, res) => {
  const rows = await Follow.find({ follower: req.user._id, targetType: 'agency' }).sort({ createdAt: -1 }).lean();
  const agencies = await Agency.find({ _id: { $in: rows.map(r => r.target) }, status: 'active' }).select('name logo verified regions').lean();
  res.status(200).json({ status: 'success', data: { agencies: agencies.map(a => ({ _id: a._id, name: a.name, logo: a.logo || '', verified: Boolean(a.verified), regions: a.regions })) } });
});

