const mongoose = require('mongoose');
const Post = require('../models/postModel');
const Comment = require('../models/commentModel');
const Reaction = require('../models/reactionModel');
const SavedPost = require('../models/savedPostModel');
const SocialReport = require('../models/socialReportModel');
const Destination = require('../models/destinationModel');
const Agency = require('../models/agencyModel');
const Package = require('../models/packageModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { originalImageUrl } = require('../utils/cache');
const {
  viewerContext, visibleFilter, canView, canComment, assertCanPost, ownerIsActive, agencyAsAuthor, userCard, USER_CARD_FIELDS, POPULATE, hydratePosts,
  pageSize, cursorFilter, nextCursor, snippet, notifySocial, unnotifySocial, checkMedia, savePostMedia, removePostMedia
} = require('../utils/social');

const validId = id => mongoose.isValidObjectId(id);
const AUDIENCES = ['public', 'followers', 'private'];

// The post if the viewer may see it (404 otherwise, so private posts don't reveal they exist)
const loadVisiblePost = async (id, ctx) => {
  const post = validId(id) ? await Post.findById(id).populate(POPULATE) : null;
  if (!post || !ownerIsActive(post) || !canView(post, ctx)) throw new AppError('This post is not available.', 404);
  return post;
};

const loadOwnPost = async (id, user) => {
  const post = validId(id) ? await Post.findById(id) : null;
  if (!post || post.status === 'removed') throw new AppError('This post is not available.', 404);
  if (post.byAgency) throw new AppError("This post is on an agency's wall. Manage it from the vendor panel.", 403);
  if (String(post.author) !== String(user._id)) throw new AppError('You can only change your own posts.', 403);
  return post;
};

// A wall post belongs to its agency, not to the staff member who wrote it, so they aren't told personally
const notifyPostAuthor = (post, fields) => (post.byAgency ? null : notifySocial({ recipient: post.author._id, ...fields }));

// Optional tags: a published destination, an active agency, a published tour event
const readTags = async (b, post) => {
  if (b.place !== undefined) {
    if (!b.place) post.place = undefined;
    else {
      const place = validId(b.place) && await Destination.findOne({ _id: b.place, status: 'published' }).select('_id name');
      if (!place) throw new AppError('Choose a place from the list.', 400);
      post.place = place._id;
      post.placeName = place.name;
    }
  }
  if (b.placeName !== undefined && !b.place) post.placeName = String(b.placeName).trim().slice(0, 120);
  if (b.agency !== undefined) {
    if (!b.agency) post.agency = undefined;
    else {
      const agency = validId(b.agency) && await Agency.findOne({ _id: b.agency, status: 'active' }).select('_id');
      if (!agency) throw new AppError('Choose an agency from the list.', 400);
      post.agency = agency._id;
    }
  }
  if (b.event !== undefined) {
    if (!b.event) post.event = undefined;
    else {
      const event = validId(b.event) && await Package.findOne({ _id: b.event, status: { $in: ['published', 'cancelled'] } }).select('_id agency');
      if (!event) throw new AppError('Choose a tour from the list.', 400);
      post.event = event._id;
      if (!post.agency) post.agency = event.agency;
    }
  }
  if (b.feeling !== undefined) post.feeling = String(b.feeling).trim().slice(0, 40);
  if (b.audience !== undefined) {
    if (!AUDIENCES.includes(b.audience)) throw new AppError('Choose who can see the post: public, followers or only me.', 400);
    post.audience = b.audience;
  }
  if (b.allowComments !== undefined) post.allowComments = b.allowComments === true || b.allowComments === 'true';
  if (b.text !== undefined) post.text = String(b.text);
};

const sendPost = async (res, status, post, ctx, message) => {
  await post.populate(POPULATE);
  const [view] = await hydratePosts([post], ctx);
  res.status(status).json({ status: 'success', ...(message ? { message } : {}), data: { post: view } });
};

// ---------- Home feed ----------

/**
 * GET /feed?tab=for_you|following&cursor=...
 * for_you: public posts from everyone plus followers-only posts from people you follow.
 * following: only people you follow (and yourself).
 */
exports.feed = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const limit = pageSize(req.query);
  const filter = { $and: [visibleFilter(ctx), cursorFilter(req.query.cursor)] };
  if (req.query.tab === 'following') {
    filter.$and.push({ $or: [{ byAgency: null, author: { $in: [...ctx.following, ctx.me] } }, { byAgency: { $in: [...ctx.followingAgencies] } }] });
  }
  const rows = await Post.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).populate(POPULATE);
  res.status(200).json({ status: 'success', data: { posts: await hydratePosts(rows, ctx), nextCursor: nextCursor(rows, limit) } });
});

// Posts tagged with a destination or an agency (for their pages in the app)
exports.taggedPosts = catchAsync(async (req, res, next) => {
  const ctx = await viewerContext(req.user);
  const limit = pageSize(req.query);
  const tag = {};
  if (validId(req.query.place)) {
    const inside = await Destination.find({ ancestors: req.query.place }).select('_id').lean();
    tag.place = { $in: [req.query.place, ...inside.map(d => d._id)] };
  } else if (validId(req.query.agency)) tag.agency = req.query.agency;
  else return next(new AppError('Say which place or agency.', 400));
  const rows = await Post.find({ $and: [visibleFilter(ctx), cursorFilter(req.query.cursor), tag] }).sort({ createdAt: -1, _id: -1 }).limit(limit).populate(POPULATE);
  res.status(200).json({ status: 'success', data: { posts: await hydratePosts(rows, ctx), nextCursor: nextCursor(rows, limit) } });
});

// ---------- Posts ----------

exports.createPost = catchAsync(async (req, res, next) => {
  assertCanPost(req.user);
  const files = req.files || [];
  checkMedia(files);
  const post = new Post({ author: req.user._id, audience: (req.user.settings && req.user.settings.privacy && req.user.settings.privacy.defaultAudience) || 'public' });
  await readTags(req.body, post);
  if (!post.text.trim() && !files.length) return next(new AppError('Write something or add a photo.', 400));
  await post.validate();
  post.media = await Promise.all(files.map(f => savePostMedia(f, req.user._id)));
  await post.save();
  await sendPost(res, 201, post, await viewerContext(req.user), 'Posted.');
});

exports.getPost = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const post = await loadVisiblePost(req.params.id, ctx);
  const [view] = await hydratePosts([post], ctx);
  res.status(200).json({ status: 'success', data: { post: view } });
});

exports.updatePost = catchAsync(async (req, res, next) => {
  assertCanPost(req.user);
  const post = await loadOwnPost(req.params.id, req.user);
  if (post.status === 'hidden') return next(new AppError('Plejar has hidden this post, so it can\'t be edited.', 403));
  const files = req.files || [];
  // The app has the smaller image's URL, which itself contains commas: back to the stored URL first
  const remove = [].concat(req.body.removeMedia || []).flatMap(v => originalImageUrl(v).split(',')).map(s => s.trim()).filter(Boolean);
  const kept = post.media.filter(m => !remove.includes(m.url));
  checkMedia(files, kept);
  await readTags(req.body, post);
  if (post.kind === 'post' && !post.text.trim() && !kept.length && !files.length) return next(new AppError('A post needs some text or a photo.', 400));
  await post.validate();
  const added = await Promise.all(files.map(f => savePostMedia(f, req.user._id)));
  const removed = post.media.filter(m => remove.includes(m.url)).map(m => m.url);
  post.media = [...kept, ...added];
  post.editedAt = new Date();
  await post.save();
  await removePostMedia(removed);
  await sendPost(res, 200, post, await viewerContext(req.user), 'Post updated.');
});

exports.deletePost = catchAsync(async (req, res) => {
  const post = await loadOwnPost(req.params.id, req.user);
  post.status = 'removed';
  await post.save();
  await removePostMedia(post.media.map(m => m.url));
  if (post.sharedFrom) await Post.updateOne({ _id: post.sharedFrom, shareCount: { $gt: 0 } }, { $inc: { shareCount: -1 } });
  await unnotifySocial({ post: post._id });
  res.status(204).json({ status: 'success', data: null });
});

// ---------- Reactions (likes) ----------

const react = async ({ user, targetType, target, kind }) => {
  if (!Reaction.KINDS.includes(kind)) throw new AppError(`Choose a reaction: ${Reaction.KINDS.join(', ')}.`, 400);
  const before = await Reaction.findOneAndUpdate({ user: user._id, targetType, target: target._id }, { kind }, { upsert: true, new: false, setDefaultsOnInsert: true });
  return { isNew: !before };
};

exports.reactToPost = catchAsync(async (req, res) => {
  assertCanPost(req.user);
  const ctx = await viewerContext(req.user);
  const post = await loadVisiblePost(req.params.id, ctx);
  const kind = req.body.kind || 'like';
  const { isNew } = await react({ user: req.user, targetType: 'post', target: post, kind });
  if (isNew) {
    await Post.updateOne({ _id: post._id }, { $inc: { reactionCount: 1 } });
    await notifyPostAuthor(post, { actor: req.user, kind: 'post_reaction', title: `${req.user.name} reacted to your post`, body: snippet(post.text), post: post._id });
  }
  res.status(200).json({ status: 'success', data: { reaction: kind, reactions: post.reactionCount + (isNew ? 1 : 0) } });
});

exports.unreactToPost = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const post = await loadVisiblePost(req.params.id, ctx);
  const gone = await Reaction.findOneAndDelete({ user: req.user._id, targetType: 'post', target: post._id });
  if (gone) {
    await Post.updateOne({ _id: post._id, reactionCount: { $gt: 0 } }, { $inc: { reactionCount: -1 } });
    await unnotifySocial({ actor: req.user._id, kind: 'post_reaction', post: post._id });
  }
  res.status(200).json({ status: 'success', data: { reaction: null, reactions: Math.max(post.reactionCount - (gone ? 1 : 0), 0) } });
});

// Who reacted, with a count per reaction
const reactionList = async (targetType, target, req, ctx) => {
  const limit = pageSize(req.query);
  const filter = { targetType, target, ...cursorFilter(req.query.cursor) };
  if (Reaction.KINDS.includes(req.query.kind)) filter.kind = req.query.kind;
  const [rows, summary] = await Promise.all([
    Reaction.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).populate('user', USER_CARD_FIELDS).lean(),
    Reaction.aggregate([{ $match: { targetType, target } }, { $group: { _id: '$kind', count: { $sum: 1 } } }])
  ]);
  return {
    summary: Object.fromEntries(summary.map(s => [s._id, s.count])),
    people: rows.filter(r => r.user && !ctx.blocked.has(String(r.user._id))).map(r => ({ ...userCard(r.user), reaction: r.kind })),
    nextCursor: nextCursor(rows, limit)
  };
};

exports.postReactions = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const post = await loadVisiblePost(req.params.id, ctx);
  res.status(200).json({ status: 'success', data: await reactionList('post', post._id, req, ctx) });
});

// ---------- Sharing ----------

// Share a public post to your own feed, optionally with a few words of your own
exports.sharePost = catchAsync(async (req, res, next) => {
  assertCanPost(req.user);
  const ctx = await viewerContext(req.user);
  let original = await loadVisiblePost(req.params.id, ctx);
  // Sharing a share shares the original
  if (original.kind === 'share' && original.sharedFrom) original = await loadVisiblePost(original.sharedFrom._id || original.sharedFrom, ctx);
  if (original.audience !== 'public') return next(new AppError('Only public posts can be shared.', 400));
  const share = new Post({ author: req.user._id, kind: 'share', sharedFrom: original._id, audience: (req.user.settings && req.user.settings.privacy && req.user.settings.privacy.defaultAudience) || 'public' });
  await readTags({ text: req.body.text, audience: req.body.audience }, share);
  await share.save();
  await Post.updateOne({ _id: original._id }, { $inc: { shareCount: 1 } });
  await notifyPostAuthor(original, { actor: req.user, kind: 'post_share', title: `${req.user.name} shared your post`, body: snippet(original.text), post: original._id });
  await sendPost(res, 201, share, ctx, 'Shared to your feed.');
});

// ---------- Saving and reporting ----------

exports.savePost = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const post = await loadVisiblePost(req.params.id, ctx);
  await SavedPost.updateOne({ user: req.user._id, post: post._id }, { $setOnInsert: { user: req.user._id, post: post._id } }, { upsert: true });
  res.status(200).json({ status: 'success', message: 'Saved.', data: { saved: true } });
});

exports.unsavePost = catchAsync(async (req, res) => {
  await SavedPost.deleteOne({ user: req.user._id, post: req.params.id });
  res.status(200).json({ status: 'success', data: { saved: false } });
});

const fileReport = async ({ reporter, targetType, target, targetUser, reason, note }) => {
  if (!SocialReport.REASONS.includes(reason)) throw new AppError(`Choose a reason: ${SocialReport.REASONS.join(', ')}.`, 400);
  if (String(targetUser) === String(reporter._id)) throw new AppError("You can't report yourself.", 400);
  const existing = await SocialReport.findOne({ reporter: reporter._id, targetType, target });
  if (existing) return { duplicate: true };
  await SocialReport.create({ reporter: reporter._id, targetType, target, targetUser, reason, note: String(note || '').slice(0, 1000) });
  return { duplicate: false };
};
exports.fileReport = fileReport;

const reportMessage = r => (r.duplicate ? 'You already reported this. Plejar\'s team will look at it.' : 'Thanks. Plejar\'s team will review it.');

exports.reportPost = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const post = await loadVisiblePost(req.params.id, ctx);
  const result = await fileReport({ reporter: req.user, targetType: 'post', target: post._id, targetUser: post.byAgency ? undefined : post.author._id, reason: req.body.reason, note: req.body.note });
  if (!result.duplicate) await Post.updateOne({ _id: post._id }, { $inc: { reportCount: 1 } });
  res.status(201).json({ status: 'success', message: reportMessage(result) });
});

// ---------- Comments and replies ----------

const COMMENT_POPULATE = [{ path: 'author', select: USER_CARD_FIELDS }, { path: 'replyTo', select: USER_CARD_FIELDS }, { path: 'asAgency', select: 'name logo verified' }];

const commentAuthor = c => {
  if (c.status !== 'active') return null;
  return c.asAgency ? agencyAsAuthor(c.asAgency) : userCard(c.author);
};

const commentView = (c, ctx, reactions) => ({
  _id: c._id,
  post: c.post,
  parent: c.parent,
  text: c.status === 'active' ? c.text : '',
  removed: c.status !== 'active',
  postedAs: c.asAgency ? 'agency' : 'traveler',
  author: commentAuthor(c),
  replyTo: c.replyTo && c.status === 'active' ? userCard(c.replyTo) : null,
  counts: { reactions: c.reactionCount, replies: c.replyCount },
  createdAt: c.createdAt,
  editedAt: c.editedAt || null,
  viewer: { reaction: reactions.get(String(c._id)) || null, isMine: Boolean(!c.asAgency && ctx.me && c.author && String(c.author._id) === ctx.me) }
});

const listComments = async (filter, dir, req, ctx) => {
  const limit = pageSize(req.query);
  const sort = dir === 'asc' ? { createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 };
  const rows = await Comment.find({ ...filter, ...cursorFilter(req.query.cursor, dir) }).sort(sort).limit(limit).populate(COMMENT_POPULATE).lean();
  // A removed comment stays as "removed" only if it still has replies to hold together
  const showing = c => c.asAgency || (c.author && !ctx.blocked.has(String(c.author._id)));
  const visible = rows.filter(c => (c.status === 'active' && showing(c)) || (c.status !== 'active' && c.replyCount > 0));
  const reactions = ctx.me
    ? new Map((await Reaction.find({ user: ctx.me, targetType: 'comment', target: { $in: visible.map(c => c._id) } }).select('target kind').lean()).map(r => [String(r.target), r.kind]))
    : new Map();
  return { comments: visible.map(c => commentView(c, ctx, reactions)), nextCursor: nextCursor(rows, limit) };
};

exports.postComments = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const post = await loadVisiblePost(req.params.id, ctx);
  // Top-level comments, oldest first like a conversation (newest first with ?sort=newest)
  const dir = req.query.sort === 'newest' ? 'desc' : 'asc';
  const data = await listComments({ post: post._id, parent: null, status: { $in: ['active', 'removed'] } }, dir, req, ctx);
  res.status(200).json({ status: 'success', data: { ...data, total: post.commentCount } });
});

exports.commentReplies = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const parent = validId(req.params.id) ? await Comment.findById(req.params.id).select('post') : null;
  if (!parent) throw new AppError('This comment is not available.', 404);
  await loadVisiblePost(parent.post, ctx);
  const data = await listComments({ parent: parent._id, status: 'active' }, 'asc', req, ctx);
  res.status(200).json({ status: 'success', data });
});

exports.addComment = catchAsync(async (req, res, next) => {
  assertCanPost(req.user);
  const ctx = await viewerContext(req.user);
  const post = await loadVisiblePost(req.params.id, ctx);
  if (!canComment(post, ctx, post.author.settings)) return next(new AppError('Comments are turned off for this post.', 403));
  const text = String(req.body.text || '').trim();
  if (!text) return next(new AppError('Write a comment.', 400));

  // Replying: replies always hang off the top-level comment, naming who is being answered
  let parent = null;
  let replyTo;
  if (req.body.parent) {
    const answered = validId(req.body.parent) ? await Comment.findOne({ _id: req.body.parent, post: post._id, status: 'active' }) : null;
    if (!answered) return next(new AppError('That comment is no longer there.', 404));
    if (!answered.asAgency && ctx.blocked.has(String(answered.author))) return next(new AppError('You can\'t reply to this person.', 403));
    parent = answered.parent ? await Comment.findById(answered.parent) : answered;
    // Answering an agency's comment answers the agency, so the staff member who wrote it isn't named or told
    replyTo = answered.asAgency ? undefined : answered.author;
  }

  const comment = await Comment.create({ post: post._id, author: req.user._id, parent: parent ? parent._id : null, replyTo, text });
  await Post.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });
  if (parent) {
    await Comment.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } });
    if (replyTo) await notifySocial({ recipient: replyTo, actor: req.user, kind: 'comment_reply', title: `${req.user.name} replied to your comment`, body: snippet(text), post: post._id, comment: comment._id });
  }
  if (!parent || post.byAgency || String(post.author._id) !== String(replyTo)) {
    await notifyPostAuthor(post, { actor: req.user, kind: 'post_comment', title: `${req.user.name} commented on your post`, body: snippet(text), post: post._id, comment: comment._id });
  }

  await comment.populate(COMMENT_POPULATE);
  res.status(201).json({ status: 'success', data: { comment: commentView(comment.toObject(), ctx, new Map()) } });
});

const loadComment = async (id, ctx) => {
  const comment = validId(id) ? await Comment.findOne({ _id: id, status: 'active' }) : null;
  if (!comment) throw new AppError('This comment is not available.', 404);
  const post = await loadVisiblePost(comment.post, ctx);
  return { comment, post };
};

exports.updateComment = catchAsync(async (req, res, next) => {
  assertCanPost(req.user);
  const ctx = await viewerContext(req.user);
  const { comment } = await loadComment(req.params.id, ctx);
  if (comment.asAgency || String(comment.author) !== ctx.me) return next(new AppError('You can only edit your own comments.', 403));
  const text = String(req.body.text || '').trim();
  if (!text) return next(new AppError('Write a comment.', 400));
  comment.text = text;
  comment.editedAt = new Date();
  await comment.save();
  await comment.populate(COMMENT_POPULATE);
  res.status(200).json({ status: 'success', data: { comment: commentView(comment.toObject(), ctx, new Map()) } });
});

// Removing a comment removes its replies too
const removeComment = async (comment, postId) => {
  const replies = comment.parent ? [] : await Comment.find({ parent: comment._id, status: 'active' }).select('_id');
  const ids = [comment._id, ...replies.map(r => r._id)];
  await Comment.updateMany({ _id: { $in: ids } }, { status: 'removed' });
  await Post.updateOne({ _id: postId }, { $inc: { commentCount: -ids.length } });
  await Post.updateOne({ _id: postId, commentCount: { $lt: 0 } }, { commentCount: 0 });
  if (comment.parent) await Comment.updateOne({ _id: comment.parent, replyCount: { $gt: 0 } }, { $inc: { replyCount: -1 } });
  await unnotifySocial({ comment: { $in: ids } });
};

// The comment's author or the post's author can remove it. On a wall, staff do that from the vendor panel.
exports.deleteComment = catchAsync(async (req, res, next) => {
  const ctx = await viewerContext(req.user);
  const { comment, post } = await loadComment(req.params.id, ctx);
  const mine = !comment.asAgency && String(comment.author) === ctx.me;
  const onMyPost = !post.byAgency && String(post.author._id) === ctx.me;
  if (!mine && !onMyPost) return next(new AppError('You can only remove your own comments, or comments on your posts.', 403));
  await removeComment(comment, post._id);
  res.status(204).json({ status: 'success', data: null });
});

exports.reactToComment = catchAsync(async (req, res) => {
  assertCanPost(req.user);
  const ctx = await viewerContext(req.user);
  const { comment, post } = await loadComment(req.params.id, ctx);
  const kind = req.body.kind || 'like';
  const { isNew } = await react({ user: req.user, targetType: 'comment', target: comment, kind });
  if (isNew) {
    await Comment.updateOne({ _id: comment._id }, { $inc: { reactionCount: 1 } });
    if (!comment.asAgency) await notifySocial({ recipient: comment.author, actor: req.user, kind: 'comment_reaction', title: `${req.user.name} reacted to your comment`, body: snippet(comment.text), post: post._id, comment: comment._id });
  }
  res.status(200).json({ status: 'success', data: { reaction: kind, reactions: comment.reactionCount + (isNew ? 1 : 0) } });
});

exports.unreactToComment = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const { comment } = await loadComment(req.params.id, ctx);
  const gone = await Reaction.findOneAndDelete({ user: req.user._id, targetType: 'comment', target: comment._id });
  if (gone) {
    await Comment.updateOne({ _id: comment._id, reactionCount: { $gt: 0 } }, { $inc: { reactionCount: -1 } });
    await unnotifySocial({ actor: req.user._id, kind: 'comment_reaction', comment: comment._id });
  }
  res.status(200).json({ status: 'success', data: { reaction: null, reactions: Math.max(comment.reactionCount - (gone ? 1 : 0), 0) } });
});

exports.commentReactions = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const { comment } = await loadComment(req.params.id, ctx);
  res.status(200).json({ status: 'success', data: await reactionList('comment', comment._id, req, ctx) });
});

exports.reportComment = catchAsync(async (req, res) => {
  const ctx = await viewerContext(req.user);
  const { comment } = await loadComment(req.params.id, ctx);
  const result = await fileReport({ reporter: req.user, targetType: 'comment', target: comment._id, targetUser: comment.asAgency ? undefined : comment.author, reason: req.body.reason, note: req.body.note });
  if (!result.duplicate) await Comment.updateOne({ _id: comment._id }, { $inc: { reportCount: 1 } });
  res.status(201).json({ status: 'success', message: reportMessage(result) });
});

// Shared with the vendor panel's wall (agencyWallController)
Object.assign(exports, { readTags, listComments, commentView, removeComment, COMMENT_POPULATE });
