const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const Follow = require('../models/followModel');
const Block = require('../models/blockModel');
const Reaction = require('../models/reactionModel');
const SavedPost = require('../models/savedPostModel');
const Notification = require('../models/notificationModel');
const AppError = require('./appError');

// Shared rules for the traveler side of the app: who sees what, who can comment, notifications, media.

// ---------- Relationships ----------

/**
 * Everything about the viewer that decides what they see:
 * who they follow (people and agencies), and who is blocked either way.
 */
const viewerContext = async viewer => {
  if (!viewer) return { me: null, following: new Set(), followingAgencies: new Set(), blocked: new Set() };
  const [follows, blocks] = await Promise.all([
    Follow.find({ follower: viewer._id }).select('targetType target').lean(),
    Block.find({ $or: [{ blocker: viewer._id }, { blocked: viewer._id }] }).select('blocker blocked').lean()
  ]);
  const me = String(viewer._id);
  return {
    me,
    following: new Set(follows.filter(f => f.targetType === 'user').map(f => String(f.target))),
    followingAgencies: new Set(follows.filter(f => f.targetType === 'agency').map(f => String(f.target))),
    blocked: new Set(blocks.map(b => (String(b.blocker) === me ? String(b.blocked) : String(b.blocker))))
  };
};

// A Mongo filter for the posts a viewer may see
const visibleFilter = ctx => {
  if (!ctx.me) return { status: 'active', audience: 'public' };
  return {
    status: 'active',
    author: { $nin: [...ctx.blocked] },
    $or: [{ author: ctx.me }, { audience: 'public' }, { audience: 'followers', author: { $in: [...ctx.following] } }]
  };
};

const canView = (post, ctx) => {
  if (!post || post.status !== 'active') return false;
  const author = String(post.author._id || post.author);
  if (ctx.blocked.has(author)) return false;
  if (author === ctx.me) return true;
  if (post.audience === 'public') return true;
  return post.audience === 'followers' && ctx.following.has(author);
};

// Comments follow the post's own switch and the author's "who can comment" setting
const canComment = (post, ctx, authorSettings) => {
  if (!ctx.me || !canView(post, ctx) || !post.allowComments) return false;
  const author = String(post.author._id || post.author);
  if (author === ctx.me) return true;
  const who = (authorSettings && authorSettings.privacy && authorSettings.privacy.whoCanComment) || 'everyone';
  if (who === 'nobody') return false;
  if (who === 'followers') return ctx.following.has(author) || false;
  return true;
};

// Signed-in travelers can post and interact, unless Plezar switched it off for them
const assertCanPost = user => {
  if (user.role !== 'user') throw new AppError('Posting, reacting and commenting are for traveler accounts in the Plezar app.', 403);
  const r = user.restrictions || {};
  if (r.posting && (!r.until || r.until > new Date())) throw new AppError('Posting and commenting are switched off for your account. Contact Plezar support.', 403);
};

// ---------- Shapes for the app ----------

const photoURL = photo => {
  if (!photo) return '/img/users/profile.png';
  return photo.startsWith('/') || photo.startsWith('http') ? photo : `/img/users/${photo}`;
};

// The place a post is tagged with: a published destination (with a link), or just the typed name
const placeView = post => {
  if (post.place && post.place.status === 'published') return { _id: post.place._id, name: post.place.name, slug: post.place.slug };
  return post.placeName ? { name: post.placeName } : null;
};

const userCard = u => (u ? {
  _id: u._id,
  name: u.name,
  photo: photoURL(u.photo),
  verified: Boolean(u.verification && u.verification.status === 'approved')
} : null);

const USER_CARD_FIELDS = 'name photo verification.status status role';

const agencyCard = a => (a ? { _id: a._id, name: a.name, logo: a.logo || '', verified: Boolean(a.verified) } : null);

/**
 * What the app needs to draw a post, including the viewer's own state
 * (their reaction, whether they saved it, whether they can comment).
 */
const postView = (post, ctx, extra = {}) => {
  if (!post) return null;
  const author = post.author || null;
  const id = String(post._id);
  const reaction = extra.reactions ? extra.reactions.get(id) || null : null;
  const view = {
    _id: post._id,
    kind: post.kind,
    text: post.text,
    media: post.media || [],
    author: userCard(author),
    place: placeView(post),
    agency: post.agency && post.agency.name ? agencyCard(post.agency) : null,
    event: post.event && post.event.title ? { _id: post.event._id, title: post.event.title, startDate: post.event.startDate } : null,
    feeling: post.feeling,
    audience: post.audience,
    allowComments: post.allowComments,
    counts: { reactions: post.reactionCount, comments: post.commentCount, shares: post.shareCount },
    createdAt: post.createdAt,
    editedAt: post.editedAt || null,
    viewer: {
      reaction,
      saved: extra.saved ? extra.saved.has(id) : false,
      isMine: Boolean(ctx.me && author && String(author._id) === ctx.me),
      canComment: canComment(post, ctx, author && author.settings)
    }
  };
  if (post.kind === 'share') {
    const original = post.sharedFrom;
    view.sharedPost = original && typeof original === 'object' && canView(original, ctx)
      ? postView(original, ctx, extra)
      : { unavailable: true, message: 'This post is no longer available.' };
  }
  return view;
};

const POPULATE = [
  { path: 'author', select: `${USER_CARD_FIELDS} settings.privacy` },
  { path: 'place', select: 'name slug status' },
  { path: 'agency', select: 'name logo verified' },
  { path: 'event', select: 'title startDate' },
  {
    path: 'sharedFrom',
    populate: [
      { path: 'author', select: `${USER_CARD_FIELDS} settings.privacy` },
      { path: 'place', select: 'name slug status' },
      { path: 'agency', select: 'name logo verified' },
      { path: 'event', select: 'title startDate' }
    ]
  }
];

// Load everything needed to show a list of posts to one viewer
const hydratePosts = async (posts, ctx) => {
  const ids = posts.flatMap(p => [p._id, p.sharedFrom && p.sharedFrom._id].filter(Boolean));
  const [reactions, saved] = ctx.me
    ? await Promise.all([
      Reaction.find({ user: ctx.me, targetType: 'post', target: { $in: ids } }).select('target kind').lean(),
      SavedPost.find({ user: ctx.me, post: { $in: ids } }).select('post').lean()
    ])
    : [[], []];
  const extra = { reactions: new Map(reactions.map(r => [String(r.target), r.kind])), saved: new Set(saved.map(s => String(s.post))) };
  // Posts by deleted or suspended accounts drop out (their author no longer loads, or isn't active)
  return posts.filter(p => p.author && p.author.status === 'active').map(p => postView(p, ctx, extra));
};

// ---------- Cursor paging ----------
// A cursor is "<createdAt ISO>_<id>" of the last item on the page; 'desc' pages newest first, 'asc' oldest first

const pageSize = q => Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 50);

const cursorFilter = (cursor, dir = 'desc') => {
  if (!cursor) return {};
  const [time, id] = String(cursor).split('_');
  const date = new Date(time);
  if (Number.isNaN(date.getTime()) || !/^[a-f\d]{24}$/i.test(id || '')) throw new AppError('That page link is not valid. Start from the top again.', 400);
  const op = dir === 'asc' ? '$gt' : '$lt';
  return { $or: [{ createdAt: { [op]: date } }, { createdAt: date, _id: { [op]: id } }] };
};

const nextCursor = (rows, limit) => {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  return `${new Date(last.createdAt).toISOString()}_${last._id}`;
};

// ---------- Notifications for social activity ----------

// Which setting switches each kind of notification off
const PREF_FOR = { post_reaction: 'reactions', comment_reaction: 'reactions', post_comment: 'comments', comment_reply: 'replies', post_share: 'shares', new_follower: 'follows' };

const snippet = (text, n = 80) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Tell a traveler someone interacted with them. Skips notifying yourself, people who
 * switched that kind off, and anyone who blocked the actor. Never throws.
 */
const notifySocial = async ({ recipient, actor, kind, title, body = '', post, comment }) => {
  try {
    if (!recipient || String(recipient._id || recipient) === String(actor._id)) return;
    const User = require('../models/userModel'); // eslint-disable-line global-require
    const target = recipient.settings ? recipient : await User.findById(recipient).select('settings');
    if (!target) return;
    const pref = PREF_FOR[kind];
    if (pref && target.settings && target.settings.notifications && target.settings.notifications[pref] === false) return;
    if (await Block.exists({ blocker: target._id, blocked: actor._id })) return;
    await Notification.create({ user: target._id, actor: actor._id, kind, title: title.slice(0, 120), body: body.slice(0, 3000), post, comment });
  } catch (err) {
    console.warn('[NOTIFY WARNING]', err.message);
  }
};

// Undo a notification when the action is undone (an unlike, an unfollow, a deleted comment)
const unnotifySocial = filter => Notification.deleteMany(filter).catch(() => {});

// ---------- Media ----------

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;
const MAX_MEDIA = 10;
const POST_MEDIA_DIR = path.join(__dirname, '..', 'public', 'media', 'posts');

const postMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO, files: MAX_MEDIA },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES.includes(file.mimetype) || VIDEO_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new AppError('Add photos (JPG, PNG, WebP) or a video (MP4, MOV, WebM).', 400), false);
  }
}).array('media', MAX_MEDIA);

const checkMedia = (files, existing = []) => {
  const all = [...existing, ...files.map(f => ({ type: IMAGE_TYPES.includes(f.mimetype) ? 'image' : 'video', size: f.size }))];
  if (all.length > MAX_MEDIA) throw new AppError(`A post can have up to ${MAX_MEDIA} photos or videos.`, 400);
  if (all.filter(m => m.type === 'video').length > 1) throw new AppError('A post can have one video.', 400);
  const bigPhoto = files.find(f => IMAGE_TYPES.includes(f.mimetype) && f.size > MAX_IMAGE);
  if (bigPhoto) throw new AppError('Each photo must be under 10 MB.', 400);
};

const randomName = () => `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;

// Photos are resized and re-encoded (which also strips location data from the camera); videos are stored as sent
const savePostMedia = async (file, userId) => {
  const dir = path.join(POST_MEDIA_DIR, String(userId));
  await fs.promises.mkdir(dir, { recursive: true });
  if (IMAGE_TYPES.includes(file.mimetype)) {
    const name = `${randomName()}.jpg`;
    const info = await sharp(file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(path.join(dir, name));
    return { type: 'image', url: `/media/posts/${userId}/${name}`, width: info.width, height: info.height, size: info.size };
  }
  const ext = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' }[file.mimetype];
  const name = `${randomName()}${ext}`;
  await fs.promises.writeFile(path.join(dir, name), file.buffer);
  return { type: 'video', url: `/media/posts/${userId}/${name}`, size: file.size };
};

const removePostMedia = async urls => Promise.all(urls.map(async url => {
  if (!url || !url.startsWith('/media/posts/')) return;
  const target = path.join(__dirname, '..', 'public', url);
  if (!target.startsWith(POST_MEDIA_DIR + path.sep)) return;
  await fs.promises.unlink(target).catch(() => {});
}));

module.exports = {
  viewerContext,
  visibleFilter,
  canView,
  canComment,
  assertCanPost,
  photoURL,
  userCard,
  agencyCard,
  USER_CARD_FIELDS,
  postView,
  POPULATE,
  hydratePosts,
  pageSize,
  cursorFilter,
  nextCursor,
  snippet,
  notifySocial,
  unnotifySocial,
  postMediaUpload,
  checkMedia,
  savePostMedia,
  removePostMedia,
  MAX_MEDIA,
  MAX_VIDEO,
  MAX_IMAGE
};
