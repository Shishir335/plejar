const mongoose = require('mongoose');
const Post = require('../models/postModel');
const Comment = require('../models/commentModel');
const Agency = require('../models/agencyModel');
const Follow = require('../models/followModel');
const User = require('../models/userModel');
const Package = require('../models/packageModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { originalImageUrl } = require('../utils/cache');
const { readTags, listComments, commentView, removeComment, COMMENT_POPULATE } = require('./postController');
const {
  viewerContext, userCard, USER_CARD_FIELDS, POPULATE, hydratePosts, pageSize, cursorFilter, nextCursor, snippet,
  notifySocial, unnotifySocial, checkMedia, savePostMedia, removePostMedia
} = require('../utils/social');

// The vendor panel's side of an agency's wall. Any staff member can manage it, as they can the agency's tours.
// Travelers read the wall through /agencies/:id/posts and react and comment through /posts/:id.

const validId = id => mongoose.isValidObjectId(id);

// Everything but posts the agency removed, including ones Plejar has hidden, so staff can see why
const findWallPost = async req => {
  const post = validId(req.params.id) ? await Post.findOne({ _id: req.params.id, byAgency: req.agency._id, status: { $ne: 'removed' } }) : null;
  if (!post) throw new AppError('No post found with that ID on your wall.', 404);
  return post;
};

// What travelers see, plus what only the agency's own staff need
const wallViews = async (rows, req) => {
  const views = await hydratePosts(rows, await viewerContext(req.user));
  const byId = new Map(rows.map(r => [String(r._id), r]));
  return views.map(view => {
    const row = byId.get(String(view._id));
    return {
      ...view,
      status: row.status,
      moderationNote: row.moderationNote || '',
      pinned: String(req.agency.pinnedPost) === String(row._id),
      postedBy: row.author ? { _id: row.author._id, name: row.author.name } : null
    };
  });
};

const sendWallPost = async (res, status, post, req, message) => {
  await post.populate(POPULATE);
  const [view] = await wallViews([post], req);
  res.status(status).json({ status: 'success', ...(message ? { message } : {}), data: { post: view } });
};

// Wall posts are always public, and can only be tagged with the agency's own tours
const readWallFields = async (req, post) => {
  const b = req.body;
  if (b.event && !(validId(b.event) && await Package.exists({ _id: b.event, agency: req.agency._id }))) {
    throw new AppError('Choose one of your own tours.', 400);
  }
  const { text, place, placeName, event, allowComments } = b;
  await readTags({ text, place, placeName, event, allowComments }, post);
  post.agency = undefined;
};

// GET /agency/me/posts?status=active|hidden&cursor&limit
// Newest first, with the pinned post at the top of the first page, as travelers see it
exports.listPosts = catchAsync(async (req, res) => {
  const limit = pageSize(req.query);
  const status = ['active', 'hidden'].includes(req.query.status) ? req.query.status : { $ne: 'removed' };
  const filter = { byAgency: req.agency._id, status };
  const pinnedId = req.agency.pinnedPost;
  const [rows, pinned] = await Promise.all([
    Post.find({ ...filter, ...cursorFilter(req.query.cursor), ...(pinnedId ? { _id: { $ne: pinnedId } } : {}) }).sort({ createdAt: -1, _id: -1 }).limit(limit).populate(POPULATE),
    pinnedId && !req.query.cursor ? Post.findOne({ ...filter, _id: pinnedId }).populate(POPULATE) : null
  ]);
  res.status(200).json({ status: 'success', data: { posts: await wallViews(pinned ? [pinned, ...rows] : rows, req), nextCursor: nextCursor(rows, limit) } });
});

exports.getPost = catchAsync(async (req, res) => {
  await sendWallPost(res, 200, await findWallPost(req), req);
});

exports.createPost = catchAsync(async (req, res, next) => {
  const files = req.files || [];
  checkMedia(files);
  const post = new Post({ author: req.user._id, byAgency: req.agency._id, audience: 'public' });
  await readWallFields(req, post);
  if (!post.text.trim() && !files.length) return next(new AppError('Write something or add a photo or video.', 400));
  await post.validate();
  post.media = await Promise.all(files.map(f => savePostMedia(f, req.agency._id)));
  await post.save();
  await logActivity(req, { action: 'wall.post_created', summary: `Posted on the wall: ${snippet(post.text, 60) || 'photos or video'}`, agency: req.agency._id });
  await sendWallPost(res, 201, post, req, 'Posted.');
});

exports.updatePost = catchAsync(async (req, res, next) => {
  const post = await findWallPost(req);
  if (post.status === 'hidden') return next(new AppError('Plejar has hidden this post, so it can\'t be edited.', 403));
  const files = req.files || [];
  // removeMedia: URLs of photos or videos to take off the post
  const remove = [].concat(req.body.removeMedia || []).map(url => originalImageUrl(url).trim()).filter(Boolean);
  const kept = post.media.filter(m => !remove.includes(m.url));
  checkMedia(files, kept);
  await readWallFields(req, post);
  if (!post.text.trim() && !kept.length && !files.length) return next(new AppError('A post needs some text, a photo or a video.', 400));
  await post.validate();
  const added = await Promise.all(files.map(f => savePostMedia(f, req.agency._id)));
  const removed = post.media.filter(m => remove.includes(m.url)).map(m => m.url);
  post.media = [...kept, ...added];
  post.editedAt = new Date();
  await post.save();
  await removePostMedia(removed);
  await logActivity(req, { action: 'wall.post_updated', summary: `Edited a wall post: ${snippet(post.text, 60) || 'photos or video'}`, agency: req.agency._id });
  await sendWallPost(res, 200, post, req, 'Post updated.');
});

exports.deletePost = catchAsync(async (req, res) => {
  const post = await findWallPost(req);
  post.status = 'removed';
  await post.save();
  await removePostMedia(post.media.map(m => m.url));
  await Agency.updateOne({ _id: req.agency._id, pinnedPost: post._id }, { $unset: { pinnedPost: 1 } });
  await unnotifySocial({ post: post._id });
  await logActivity(req, { action: 'wall.post_removed', summary: `Removed a wall post: ${snippet(post.text, 60) || 'photos or video'}`, agency: req.agency._id });
  res.status(204).json({ status: 'success', data: null });
});

// One post stays at the top of the wall. Pinning another replaces it.
exports.pinPost = catchAsync(async (req, res, next) => {
  const post = await findWallPost(req);
  if (post.status !== 'active') return next(new AppError('Plejar has hidden this post, so it can\'t be pinned.', 403));
  await Agency.updateOne({ _id: req.agency._id }, { pinnedPost: post._id });
  req.agency.pinnedPost = post._id;
  await sendWallPost(res, 200, post, req, 'Pinned to the top of your wall.');
});

exports.unpinPost = catchAsync(async (req, res) => {
  const post = await findWallPost(req);
  await Agency.updateOne({ _id: req.agency._id, pinnedPost: post._id }, { $unset: { pinnedPost: 1 } });
  if (String(req.agency.pinnedPost) === String(post._id)) req.agency.pinnedPost = undefined;
  await sendWallPost(res, 200, post, req, 'Unpinned.');
});

// ---------- Followers ----------

// GET /agency/me/followers?cursor&limit
// Newest first. Only what a public profile shows: a follower's email and phone stay private.
exports.listFollowers = catchAsync(async (req, res) => {
  const limit = pageSize(req.query);
  const filter = { targetType: 'agency', target: req.agency._id };
  const rows = await Follow.find({ ...filter, ...cursorFilter(req.query.cursor) }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  const [users, allIds] = await Promise.all([
    User.find({ _id: { $in: rows.map(r => r.follower) }, status: 'active' }).select(USER_CARD_FIELDS).lean(),
    Follow.distinct('follower', filter)
  ]);
  const byId = new Map(users.map(u => [String(u._id), u]));
  const followers = rows.filter(r => byId.has(String(r.follower))).map(r => ({ ...userCard(byId.get(String(r.follower))), followedAt: r.createdAt }));
  const total = await User.countDocuments({ _id: { $in: allIds }, status: 'active' });
  res.status(200).json({ status: 'success', data: { followers, total, nextCursor: nextCursor(rows, limit) } });
});

// ---------- Comments on the wall ----------

// Staff see every comment on their wall, whoever they've blocked in their own traveler account
const staffContext = async req => ({ ...(await viewerContext(req.user)), blocked: new Set() });

exports.listComments = catchAsync(async (req, res) => {
  const post = await findWallPost(req);
  const dir = req.query.sort === 'newest' ? 'desc' : 'asc';
  const data = await listComments({ post: post._id, parent: null, status: { $in: ['active', 'removed'] } }, dir, req, await staffContext(req));
  res.status(200).json({ status: 'success', data: { ...data, total: post.commentCount } });
});

// Comment or reply as the agency. { text, parent: <comment id, to reply> }
exports.addComment = catchAsync(async (req, res, next) => {
  const post = await findWallPost(req);
  if (post.status !== 'active') return next(new AppError('Plejar has hidden this post, so it can\'t be commented on.', 403));
  const text = String(req.body.text || '').trim();
  if (!text) return next(new AppError('Write a comment.', 400));

  let parent = null;
  let answered = null;
  if (req.body.parent) {
    answered = validId(req.body.parent) ? await Comment.findOne({ _id: req.body.parent, post: post._id, status: 'active' }) : null;
    if (!answered) return next(new AppError('That comment is no longer there.', 404));
    parent = answered.parent ? await Comment.findById(answered.parent) : answered;
  }
  const replyTo = answered && !answered.asAgency ? answered.author : undefined;

  const comment = await Comment.create({ post: post._id, author: req.user._id, asAgency: req.agency._id, parent: parent ? parent._id : null, replyTo, text });
  await Post.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });
  if (parent) await Comment.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } });
  if (replyTo) {
    await notifySocial({ recipient: replyTo, actor: req.user, asAgency: req.agency._id, kind: 'comment_reply', title: `${req.agency.name} replied to your comment`, body: snippet(text), post: post._id, comment: comment._id });
  }

  await comment.populate(COMMENT_POPULATE);
  res.status(201).json({ status: 'success', data: { comment: commentView(comment.toObject(), await staffContext(req), new Map()) } });
});

// A comment on this agency's wall
const findWallComment = async req => {
  const comment = validId(req.params.id) ? await Comment.findOne({ _id: req.params.id, status: 'active' }) : null;
  if (!comment || !await Post.exists({ _id: comment.post, byAgency: req.agency._id })) throw new AppError('No comment found with that ID on your wall.', 404);
  return comment;
};

exports.listReplies = catchAsync(async (req, res) => {
  const parent = await findWallComment(req);
  const data = await listComments({ parent: parent._id, status: 'active' }, 'asc', req, await staffContext(req));
  res.status(200).json({ status: 'success', data });
});

exports.removeComment = catchAsync(async (req, res) => {
  const comment = await findWallComment(req);
  await removeComment(comment, comment.post);
  await logActivity(req, { action: 'wall.comment_removed', summary: `Removed a comment from the wall: ${snippet(comment.text, 60)}`, agency: req.agency._id });
  res.status(204).json({ status: 'success', data: null });
});
