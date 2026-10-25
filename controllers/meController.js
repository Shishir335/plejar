const path = require('path');
const User = require('../models/userModel');
const Post = require('../models/postModel');
const SavedPost = require('../models/savedPostModel');
const Block = require('../models/blockModel');
const Follow = require('../models/followModel');
const Agency = require('../models/agencyModel');
const Booking = require('../models/bookingModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { saveProfileImage, removeProfileImage } = require('../utils/userImages');
const { readPersonName, readDateOfBirth } = require('../utils/registration');
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

// PATCH /me/profile (multipart: photo, cover) firstName, lastName, dateOfBirth, bio, hometown, phone (name still works)
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
  if (b.phone !== undefined) {
    const phone = String(b.phone).replace(/[\s-]/g, '');
    if (phone && !/^(?:\+?880|0)1[3-9]\d{8}$/.test(phone)) return next(new AppError('Enter a Bangladeshi mobile number, for example 01712345678.', 400));
    user.phone = phone;
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

exports.getSettings = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: { settings: req.user.settings } });
});

// PATCH /me/settings { privacy: {...}, notifications: {...}, language }
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
  ['reactions', 'comments', 'replies', 'shares', 'follows', 'tours'].forEach(k => {
    if (notifications[k] !== undefined) user.settings.notifications[k] = Boolean(notifications[k]);
  });
  if (language !== undefined) {
    if (!['en', 'bn'].includes(language)) return next(new AppError('Choose English (en) or Bangla (bn).', 400));
    user.settings.language = language;
  }
  await user.save({ validateBeforeSave: false });
  res.status(200).json({ status: 'success', message: 'Settings saved.', data: { settings: user.settings } });
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

