const mongoose = require('mongoose');
const User = require('../models/userModel');
const Post = require('../models/postModel');
const Follow = require('../models/followModel');
const Block = require('../models/blockModel');
const Booking = require('../models/bookingModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { roleFilter } = require('../utils/roles');
const { escapeRegex } = require('../utils/query');
const { viewerContext, visibleFilter, userCard, USER_CARD_FIELDS, POPULATE, hydratePosts, pageSize, cursorFilter, nextCursor, notifySocial, unnotifySocial } = require('../utils/social');
const { fileReport } = require('./postController');

// Other travelers: profiles, following, blocking and reporting

const validId = id => mongoose.isValidObjectId(id);

// Only active traveler accounts have public profiles
const findTraveler = async (id, ctx) => {
  const user = validId(id) ? await User.findOne({ $and: [{ _id: id, status: 'active' }, roleFilter('user')] }) : null;
  if (!user || (ctx && ctx.blocked.has(String(user._id)))) throw new AppError('This profile is not available.', 404);
  return user;
};

const countsFor = async (userId, ctx) => {
  const [followers, following, posts, trips] = await Promise.all([
    Follow.countDocuments({ targetType: 'user', target: userId }),
    Follow.countDocuments({ follower: userId }),
    Post.countDocuments({ ...visibleFilter(ctx), author: userId }),
    Booking.countDocuments({ user: userId, status: 'completed' })
  ]);
  return { followers, following, posts, trips };
};

exports.search = catchAsync(async (req, res, next) => {
  const ctx = await viewerContext(req.user);
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return next(new AppError('Type at least 2 letters to search.', 400));
  const rows = await User.find({ $and: [{ status: 'active', name: { $regex: escapeRegex(q), $options: 'i' }, _id: { $nin: [...ctx.blocked] } }, roleFilter('user')] })
    .limit(pageSize(req.query)).select(USER_CARD_FIELDS).lean();
  res.status(200).json({ status: 'success', data: { people: rows.map(u => ({ ...userCard(u), following: ctx.following.has(String(u._id)) })) } });
});

exports.profile = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const user = await findTraveler(req.params.id, ctx);
  const counts = await countsFor(user._id, ctx);
  const showTrips = !(user.settings && user.settings.privacy && user.settings.privacy.showTrips === false) || String(user._id) === ctx.me;
  const followsYou = ctx.me ? Boolean(await Follow.exists({ follower: user._id, targetType: 'user', target: ctx.me })) : false;
  // What the traveler chose to show in Settings > Profile (they always see their own)
  const isMe = String(user._id) === ctx.me;
  const privacy = (user.settings && user.settings.privacy) || {};
  const showInfo = isMe || privacy.showPersonalInfo !== false;
  const home = (user.addresses || []).find(a => a.isDefault);
  const location = (isMe || privacy.showAddress) && home ? `${home.area}, ${home.district}` : null;
  res.status(200).json({
    status: 'success',
    data: {
      profile: {
        ...userCard(user),
        bio: showInfo ? user.bio : '',
        coverPhoto: user.coverPhoto,
        hometown: showInfo ? user.hometown : '',
        occupation: showInfo ? user.occupation || '' : '',
        location,
        joinedAt: user._id.getTimestamp(),
        counts: { ...counts, trips: showTrips ? counts.trips : null },
        viewer: { isMe: String(user._id) === ctx.me, following: ctx.following.has(String(user._id)), followsYou }
      }
    }
  });
});

exports.posts = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const user = await findTraveler(req.params.id, ctx);
  const limit = pageSize(req.query);
  const rows = await Post.find({ $and: [visibleFilter(ctx), cursorFilter(req.query.cursor), { author: user._id }] }).sort({ createdAt: -1, _id: -1 }).limit(limit).populate(POPULATE);
  res.status(200).json({ status: 'success', data: { posts: await hydratePosts(rows, ctx), nextCursor: nextCursor(rows, limit) } });
});

const followList = async (filter, pick, req, ctx) => {
  const limit = pageSize(req.query);
  const rows = await Follow.find({ ...filter, ...cursorFilter(req.query.cursor) }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  const ids = rows.map(pick);
  const users = await User.find({ _id: { $in: ids }, status: 'active' }).select(USER_CARD_FIELDS).lean();
  const byId = new Map(users.map(u => [String(u._id), u]));
  return {
    people: ids.map(id => byId.get(String(id))).filter(u => u && !ctx.blocked.has(String(u._id))).map(u => ({ ...userCard(u), following: ctx.following.has(String(u._id)) })),
    nextCursor: nextCursor(rows, limit)
  };
};

exports.followers = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const user = await findTraveler(req.params.id, ctx);
  res.status(200).json({ status: 'success', data: await followList({ targetType: 'user', target: user._id }, f => f.follower, req, ctx) });
});

exports.following = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const user = await findTraveler(req.params.id, ctx);
  res.status(200).json({ status: 'success', data: await followList({ follower: user._id, targetType: 'user' }, f => f.target, req, ctx) });
});

exports.follow = catchAsync(async (req, res, next) => {
  const ctx = await viewerContext(req.user);
  const user = await findTraveler(req.params.id, ctx);
  if (String(user._id) === ctx.me) return next(new AppError("You can't follow yourself.", 400));
  const result = await Follow.updateOne({ follower: req.user._id, targetType: 'user', target: user._id }, { $setOnInsert: { follower: req.user._id, targetType: 'user', target: user._id } }, { upsert: true });
  if (result.upsertedCount) {
    await notifySocial({ recipient: user, actor: req.user, kind: 'new_follower', title: `${req.user.name} started following you` });
  }
  res.status(200).json({ status: 'success', message: `You're following ${user.name}.`, data: { following: true } });
});

exports.unfollow = catchAsync(async (req, res) => {
  if (validId(req.params.id)) {
    await Follow.deleteOne({ follower: req.user._id, targetType: 'user', target: req.params.id });
    await unnotifySocial({ actor: req.user._id, user: req.params.id, kind: 'new_follower' });
  }
  res.status(200).json({ status: 'success', data: { following: false } });
});

// Blocking removes follows both ways and hides each other's posts and comments
exports.block = catchAsync(async (req, res, next) => {
  const user = await findTraveler(req.params.id);
  if (String(user._id) === String(req.user._id)) return next(new AppError("You can't block yourself.", 400));
  await Block.updateOne({ blocker: req.user._id, blocked: user._id }, { $setOnInsert: { blocker: req.user._id, blocked: user._id } }, { upsert: true });
  await Follow.deleteMany({ $or: [{ follower: req.user._id, targetType: 'user', target: user._id }, { follower: user._id, targetType: 'user', target: req.user._id }] });
  res.status(200).json({ status: 'success', message: `${user.name} is blocked. You won't see each other's posts or comments.`, data: { blocked: true } });
});

exports.unblock = catchAsync(async (req, res) => {
  if (validId(req.params.id)) await Block.deleteOne({ blocker: req.user._id, blocked: req.params.id });
  res.status(200).json({ status: 'success', data: { blocked: false } });
});

exports.report = catchAsync(async (req, res) => {
  const user = await findTraveler(req.params.id);
  const result = await fileReport({ reporter: req.user, targetType: 'user', target: user._id, targetUser: user._id, reason: req.body.reason, note: req.body.note });
  res.status(201).json({ status: 'success', message: result.duplicate ? 'You already reported this person. Plejar\'s team will look at it.' : 'Thanks. Plejar\'s team will review it.' });
});

