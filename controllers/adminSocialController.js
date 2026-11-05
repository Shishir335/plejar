const mongoose = require('mongoose');
const Post = require('../models/postModel');
const Comment = require('../models/commentModel');
const User = require('../models/userModel');
const SocialReport = require('../models/socialReportModel');
const Notification = require('../models/notificationModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { roleFilter } = require('../utils/roles');
const { logActivity } = require('../utils/activity');
const { escapeRegex, pageParams, paged } = require('../utils/query');
const { snippet } = require('../utils/social');

// Moderating what travelers and agencies post in the app: posts, comments and the reports on them

const validId = id => mongoose.isValidObjectId(id);
const AUTHOR = 'name email photo status restrictions';

const postRow = p => ({
  _id: p._id,
  kind: p.kind,
  text: p.text,
  media: p.media,
  audience: p.audience,
  status: p.status,
  moderationNote: p.moderationNote || '',
  moderatedAt: p.moderatedAt || null,
  counts: { reactions: p.reactionCount, comments: p.commentCount, shares: p.shareCount, reports: p.reportCount },
  author: p.author ? { _id: p.author._id, name: p.author.name, email: p.author.email, status: p.author.status } : null,
  // On this agency's wall (author is the staff member who wrote it)
  agency: p.byAgency ? { _id: p.byAgency._id, name: p.byAgency.name } : null,
  placeName: p.placeName || (p.place && p.place.name) || '',
  createdAt: p.createdAt
});

exports.summary = catchAsync(async (req, res) => {
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const [posts, postsToday, hidden, reported, openReports, comments, restricted] = await Promise.all([
    Post.countDocuments({ status: { $ne: 'removed' } }),
    Post.countDocuments({ createdAt: { $gte: dayAgo } }),
    Post.countDocuments({ status: 'hidden' }),
    Post.countDocuments({ status: 'active', reportCount: { $gt: 0 } }),
    SocialReport.countDocuments({ status: 'open' }),
    Comment.countDocuments({ status: 'active' }),
    User.countDocuments({ 'restrictions.posting': true })
  ]);
  res.status(200).json({ status: 'success', data: { posts, postsToday, hidden, reported, openReports, comments, restricted } });
});

/**
 * GET /admin/posts?status=active|hidden|removed&reported=true&author=<id>&search&page
 * Reported posts come first when ?reported=true.
 */
exports.listPosts = catchAsync(async (req, res) => {
  const q = req.query;
  const filter = {};
  if (['active', 'hidden', 'removed'].includes(q.status)) filter.status = q.status;
  if (q.reported === 'true') filter.reportCount = { $gt: 0 };
  if (validId(q.author)) filter.author = q.author;
  if (q.search) filter.text = { $regex: escapeRegex(String(q.search).trim()), $options: 'i' };
  const pg = pageParams(q);
  const sort = q.reported === 'true' ? { reportCount: -1, createdAt: -1 } : { createdAt: -1 };
  const [rows, total] = await Promise.all([
    Post.find(filter).sort(sort).skip(pg.skip).limit(pg.limit).populate('author', AUTHOR).populate('byAgency', 'name').populate('place', 'name').lean(),
    Post.countDocuments(filter)
  ]);
  res.status(200).json({ status: 'success', data: { posts: rows.map(postRow), ...paged(total, pg) } });
});

exports.getPost = catchAsync(async (req, res, next) => {
  const post = validId(req.params.id) ? await Post.findById(req.params.id).populate('author', AUTHOR).populate('byAgency', 'name').populate('place', 'name').lean() : null;
  if (!post) return next(new AppError('No post found with that ID.', 404));
  const [comments, reports] = await Promise.all([
    Comment.find({ post: post._id }).sort({ createdAt: 1 }).limit(200).populate('author', 'name email').lean(),
    SocialReport.find({ targetType: 'post', target: post._id }).sort({ createdAt: -1 }).populate('reporter', 'name email').lean()
  ]);
  res.status(200).json({
    status: 'success',
    data: {
      post: postRow(post),
      comments: comments.map(c => ({ _id: c._id, parent: c.parent, text: c.text, status: c.status, reportCount: c.reportCount, author: c.author, createdAt: c.createdAt })),
      reports
    }
  });
});

const tellAuthor = (userId, post, title, body) => Notification.create({ user: userId, kind: 'post_hidden', title, body, post: post._id }).catch(() => {});

// Hide (gone from the app until shown again), show again, or remove for good
const applyPostAction = async (req, post, action, note) => {
  const was = post.status;
  if (action === 'hide') post.status = 'hidden';
  else if (action === 'remove') post.status = 'removed';
  else post.status = 'active';
  post.moderationNote = action === 'unhide' ? '' : note;
  post.moderatedBy = req.user._id;
  post.moderatedAt = new Date();
  await post.save();

  // A removed share no longer counts on the original
  if (post.sharedFrom && was !== 'removed' && post.status === 'removed') await Post.updateOne({ _id: post.sharedFrom }, { $inc: { shareCount: -1 } });

  const label = { hide: 'hidden', remove: 'removed', unhide: 'restored' }[action];
  if (action !== 'unhide') {
    await tellAuthor(post.author, post, `Your post was ${label}`, `Your post "${snippet(post.text, 60) || 'with photos'}" was ${label} because it goes against Plejar's community rules. ${note}`);
  }
  await logActivity(req, { action: `post.${label}`, summary: action === 'unhide' ? 'Post shown again' : `Post ${label}: ${note}`, user: post.author });
};

const readAction = (body, allowed) => {
  const action = String(body.action || '');
  if (!allowed.includes(action)) throw new AppError(`Choose an action: ${allowed.join(', ')}.`, 400);
  const note = String(body.note || '').trim().slice(0, 300);
  if (action !== 'unhide' && note.length < 3) throw new AppError('Add a short reason. The author will see it.', 400);
  return { action, note };
};

// PATCH /admin/posts/:id { action: hide|unhide|remove, note }
exports.moderatePost = catchAsync(async (req, res, next) => {
  const { action, note } = readAction(req.body, ['hide', 'unhide', 'remove']);
  const post = validId(req.params.id) ? await Post.findById(req.params.id) : null;
  if (!post) return next(new AppError('No post found with that ID.', 404));
  if (post.status === 'removed' && action !== 'remove') return next(new AppError('This post was removed and cannot be shown again.', 400));
  await applyPostAction(req, post, action, note);
  res.status(200).json({ status: 'success', data: { post: { _id: post._id, status: post.status, moderationNote: post.moderationNote } } });
});

const applyCommentAction = async (req, comment, action, note) => {
  const was = comment.status;
  comment.status = action === 'hide' ? 'hidden' : 'active';
  await comment.save();
  if (was === comment.status) return;
  // Hidden comments stop counting on the post (and on their thread)
  const delta = action === 'hide' ? -1 : 1;
  await Post.updateOne({ _id: comment.post }, { $inc: { commentCount: delta } });
  if (comment.parent) await Comment.updateOne({ _id: comment.parent }, { $inc: { replyCount: delta } });
  await logActivity(req, { action: action === 'hide' ? 'comment.hidden' : 'comment.restored', summary: action === 'hide' ? `Comment hidden: ${note}` : 'Comment shown again', user: comment.author });
};

// PATCH /admin/comments/:id { action: hide|unhide, note }
exports.moderateComment = catchAsync(async (req, res, next) => {
  const { action, note } = readAction(req.body, ['hide', 'unhide']);
  const comment = validId(req.params.id) ? await Comment.findById(req.params.id) : null;
  if (!comment || comment.status === 'removed') return next(new AppError('No comment found with that ID.', 404));
  await applyCommentAction(req, comment, action, note);
  res.status(200).json({ status: 'success', data: { comment: { _id: comment._id, status: comment.status } } });
});

// ---------- Reports ----------

const targetSummaries = async reports => {
  const ids = type => reports.filter(r => r.targetType === type).map(r => r.target);
  const [posts, comments, users] = await Promise.all([
    Post.find({ _id: { $in: ids('post') } }).select('text media status author byAgency').populate('byAgency', 'name').lean(),
    Comment.find({ _id: { $in: ids('comment') } }).select('text status post author').lean(),
    User.find({ _id: { $in: ids('user') } }).select('name email status').lean()
  ]);
  const map = rows => new Map(rows.map(r => [String(r._id), r]));
  const all = { post: map(posts), comment: map(comments), user: map(users) };
  return r => {
    const t = all[r.targetType].get(String(r.target));
    if (!t) return { missing: true };
    if (r.targetType === 'post') return { text: snippet(t.text, 140), photos: (t.media || []).length, status: t.status, agency: t.byAgency ? t.byAgency.name : null };
    if (r.targetType === 'comment') return { text: snippet(t.text, 140), status: t.status, post: t.post };
    return { name: t.name, email: t.email, status: t.status };
  };
};

/**
 * GET /admin/social-reports?status=open|action_taken|dismissed&targetType=post|comment|user&page
 * Each row says how many people reported the same thing.
 */
exports.listReports = catchAsync(async (req, res) => {
  const q = req.query;
  const filter = {};
  filter.status = ['open', 'action_taken', 'dismissed'].includes(q.status) ? q.status : 'open';
  if (['post', 'comment', 'user'].includes(q.targetType)) filter.targetType = q.targetType;
  const pg = pageParams(q);
  const [rows, total] = await Promise.all([
    SocialReport.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit)
      .populate('reporter', 'name email').populate('targetUser', 'name email').populate('resolvedBy', 'name').lean(),
    SocialReport.countDocuments(filter)
  ]);
  const [summarize, counts] = await Promise.all([
    targetSummaries(rows),
    SocialReport.aggregate([{ $match: { target: { $in: rows.map(r => r.target) }, status: 'open' } }, { $group: { _id: '$target', count: { $sum: 1 } } }])
  ]);
  const openFor = new Map(counts.map(c => [String(c._id), c.count]));
  res.status(200).json({
    status: 'success',
    data: {
      reports: rows.map(r => ({ ...r, targetSummary: summarize(r), openReportsOnTarget: openFor.get(String(r.target)) || 0 })),
      reasons: SocialReport.REASONS,
      ...paged(total, pg)
    }
  });
});

/**
 * PATCH /admin/social-reports/:id
 * { status: action_taken|dismissed, resolution, hideTarget: true, restrictUser: true }
 * Resolves every open report on the same post, comment or person at once.
 */
exports.resolveReport = catchAsync(async (req, res, next) => {
  const report = validId(req.params.id) ? await SocialReport.findById(req.params.id) : null;
  if (!report) return next(new AppError('No report found with that ID.', 404));
  const status = String(req.body.status || '');
  if (!['action_taken', 'dismissed'].includes(status)) return next(new AppError('Mark the report as action taken or dismissed.', 400));
  const resolution = String(req.body.resolution || '').trim().slice(0, 500);
  if (resolution.length < 3) return next(new AppError('Add a short note about what you decided.', 400));
  const yes = v => v === true || v === 'true';
  const done = [];

  if (status === 'action_taken' && yes(req.body.hideTarget)) {
    if (report.targetType === 'post') {
      const post = await Post.findById(report.target);
      if (post && post.status === 'active') { await applyPostAction(req, post, 'hide', resolution); done.push('post hidden'); }
    } else if (report.targetType === 'comment') {
      const comment = await Comment.findById(report.target);
      if (comment && comment.status === 'active') { await applyCommentAction(req, comment, 'hide', resolution); done.push('comment hidden'); }
    }
  }

  if (status === 'action_taken' && yes(req.body.restrictUser) && report.targetUser) {
    const user = await User.findOne({ $and: [{ _id: report.targetUser }, roleFilter('user')] });
    if (user) {
      user.restrictions = { ...(user.restrictions ? user.restrictions.toObject() : {}), posting: true, reason: resolution, setBy: req.user._id, setAt: new Date() };
      await user.save({ validateBeforeSave: false });
      await logActivity(req, { action: 'user.restricted', summary: `Restricted from: posting. ${resolution}`, user: user._id });
      done.push('author can no longer post or comment');
    }
  }

  const result = await SocialReport.updateMany(
    { targetType: report.targetType, target: report.target, status: 'open' },
    { status, resolution, resolvedBy: req.user._id, resolvedAt: new Date() }
  );
  // A report that was already closed is updated on its own
  if (report.status !== 'open') await SocialReport.updateOne({ _id: report._id }, { status, resolution, resolvedBy: req.user._id, resolvedAt: new Date() });

  await logActivity(req, { action: `social_report.${status}`, summary: `Report on a ${report.targetType} ${status === 'dismissed' ? 'dismissed' : 'acted on'}${done.length ? ` (${done.join(', ')})` : ''}: ${resolution}`, user: report.targetUser });
  res.status(200).json({ status: 'success', message: `${result.modifiedCount || 1} report(s) closed${done.length ? `: ${done.join(', ')}` : ''}.`, data: { closed: result.modifiedCount, actions: done } });
});
