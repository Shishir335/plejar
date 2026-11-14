const mongoose = require('mongoose');
const Agency = require('../models/agencyModel');
const Package = require('../models/packageModel');
const Review = require('../models/reviewModel');
const Follow = require('../models/followModel');
const Post = require('../models/postModel');
const Announcement = require('../models/announcementModel');
const VendorCategory = require('../models/vendorCategoryModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { escapeRegex, pageParams, paged } = require('../utils/query');
const { userCard, viewerContext, hydratePosts, POPULATE, pageSize, cursorFilter, nextCursor, snippet, wallCounts } = require('../utils/social');
const { registrationStats, withStats } = require('../utils/events');

// The Agents tab in the app: browse tour agencies, open one, follow it

const validId = id => mongoose.isValidObjectId(id);

// Ratings, followers and upcoming tours for a set of agencies
const agencyNumbers = async (ids, viewer) => {
  const now = new Date();
  const [ratings, followers, upcoming, mine] = await Promise.all([
    // Reviews an admin hid don't count (as the admin panel promises)
    Review.aggregate([{ $match: { agency: { $in: ids }, status: { $ne: 'hidden' } } }, { $group: { _id: '$agency', average: { $avg: '$rating' }, count: { $sum: 1 } } }]),
    Follow.aggregate([{ $match: { targetType: 'agency', target: { $in: ids } } }, { $group: { _id: '$target', count: { $sum: 1 } } }]),
    Package.aggregate([{ $match: { agency: { $in: ids }, status: 'published', startDate: { $gte: now } } }, { $group: { _id: '$agency', count: { $sum: 1 } } }]),
    viewer ? Follow.find({ follower: viewer._id, targetType: 'agency', target: { $in: ids } }).select('target').lean() : []
  ]);
  const map = rows => new Map(rows.map(r => [String(r._id), r]));
  return { ratings: map(ratings), followers: map(followers), upcoming: map(upcoming), following: new Set(mine.map(f => String(f.target))) };
};

// How well rated an agency is, weighing how many reviews back it up: a single 5-star review counts for less
// than fifty 4.9s. Agencies without reviews come last.
const RATING_PRIOR = 4;
const RATING_WEIGHT = 3;
const ratingScore = c => (c.rating.count
  ? (c.rating.average * c.rating.count + RATING_PRIOR * RATING_WEIGHT) / (c.rating.count + RATING_WEIGHT)
  : -1);

const agencyCardView = (a, n) => {
  const r = n.ratings.get(String(a._id));
  return {
    _id: a._id,
    name: a.name,
    logo: a.logo || '',
    regions: a.regions || [],
    verified: Boolean(a.verified),
    categories: (a.categories || []).map(c => (c && c.name ? c.name : null)).filter(Boolean),
    rating: r ? { average: Math.round(r.average * 10) / 10, count: r.count } : { average: null, count: 0 },
    followers: (n.followers.get(String(a._id)) || { count: 0 }).count,
    upcomingTours: (n.upcoming.get(String(a._id)) || { count: 0 }).count,
    viewer: { following: n.following.has(String(a._id)) }
  };
};

/**
 * GET /agencies?search&region&category&verified=true&sort=popular|rating|newest|name&page
 * Active agencies only; verified agencies first unless sorted otherwise.
 */
exports.listAgencies = catchAsync(async (req, res) => {
  const q = req.query;
  // Hotels that joined Plejar are shown as hotel listings, not as tour agencies
  const filter = { status: 'active', kind: { $ne: 'hotel' } };
  if (q.search) {
    const rx = { $regex: escapeRegex(String(q.search).trim()), $options: 'i' };
    filter.$or = [{ name: rx }, { regions: rx }, { description: rx }];
  }
  if (q.region) filter.regions = { $regex: `^${escapeRegex(String(q.region).trim())}$`, $options: 'i' };
  if (validId(q.category)) filter.categories = q.category;
  if (q.verified === 'true') filter.verified = true;

  const page = pageParams(q);
  const sortKey = ['popular', 'rating', 'newest', 'name'].includes(q.sort) ? q.sort : 'popular';
  let rows;
  let total;
  if (sortKey === 'newest' || sortKey === 'name') {
    [rows, total] = await Promise.all([
      Agency.find(filter).sort(sortKey === 'name' ? { name: 1 } : { createdAt: -1 }).skip(page.skip).limit(page.limit).populate('categories', 'name').lean(),
      Agency.countDocuments(filter)
    ]);
    const n = await agencyNumbers(rows.map(r => r._id), req.user);
    return res.status(200).json({ status: 'success', data: { agencies: rows.map(a => agencyCardView(a, n)), ...paged(total, page) } });
  }

  // Popular and rating sorts need the numbers for every match first
  rows = await Agency.find(filter).populate('categories', 'name').lean();
  const n = await agencyNumbers(rows.map(r => r._id), req.user);
  const cards = rows.map(a => agencyCardView(a, n));
  const score = sortKey === 'rating'
    ? c => ratingScore(c) * 1e6 + c.rating.count
    : c => (c.verified ? 1e6 : 0) + c.followers * 3 + c.upcomingTours * 5 + c.rating.count * 2 + (c.rating.average || 0);
  cards.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  res.status(200).json({ status: 'success', data: { agencies: cards.slice(page.skip, page.skip + page.limit), ...paged(cards.length, page) } });
});

/**
 * The best-rated agencies for the app's Home screen ("Top rated agents"): active travel agencies with at
 * least one visible review, best first.
 */
exports.topRatedAgencies = async (viewer, limit = 10) => {
  const rows = await Agency.find({ status: 'active', kind: { $ne: 'hotel' } }).populate('categories', 'name').lean();
  if (!rows.length) return [];
  const n = await agencyNumbers(rows.map(r => r._id), viewer);
  return rows.map(a => agencyCardView(a, n))
    .filter(c => c.rating.count > 0)
    .sort((a, b) => ratingScore(b) - ratingScore(a) || b.rating.count - a.rating.count || a.name.localeCompare(b.name))
    .slice(0, limit);
};

// Filters for the Agents tab: regions agencies cover and the vendor categories
exports.filters = catchAsync(async (req, res) => {
  const [regions, categories] = await Promise.all([
    Agency.distinct('regions', { status: 'active', kind: { $ne: 'hotel' } }),
    VendorCategory.find({ active: true }).sort({ name: 1 }).select('name').lean()
  ]);
  res.status(200).json({ status: 'success', data: { regions: regions.filter(Boolean).sort((a, b) => a.localeCompare(b)), categories } });
});

exports.getAgency = catchAsync(async (req, res, next) => {
  const agency = validId(req.params.id) ? await Agency.findOne({ _id: req.params.id, status: 'active', kind: { $ne: 'hotel' } }).populate('categories', 'name').lean() : null;
  if (!agency) return next(new AppError('This agency is not available.', 404));
  const n = await agencyNumbers([agency._id], req.user);
  const [events, reviews, announcements, counts] = await Promise.all([
    Package.find({ agency: agency._id, status: 'published', startDate: { $gte: new Date() } }).sort({ startDate: 1 }).limit(10)
      .select('title destination startDate endDate priceFrom seats photos durationDays durationNights').lean(),
    Review.find({ agency: agency._id, status: { $ne: 'hidden' } }).sort({ createdAt: -1 }).limit(5).populate('user', 'name photo verification.status').select('rating comment createdAt user').lean(),
    Announcement.find({ agency: agency._id, status: 'published' }).sort({ pinned: -1, publishedAt: -1 }).limit(5).select('title body pinned publishedAt').lean(),
    wallCounts(agency._id)
  ]);
  const stats = await registrationStats(events.map(e => e._id));
  res.status(200).json({
    status: 'success',
    data: {
      agency: {
        ...agencyCardView(agency, n),
        cover: agency.cover || '',
        tagline: agency.tagline || '',
        address: agency.address || '',
        socialLinks: agency.socialLinks || {},
        counts,
        description: agency.description,
        contact: { phone: agency.phone, email: agency.email, website: agency.website },
        memberSince: agency.createdAt
      },
      upcomingTours: events.map(e => {
        const w = withStats(e, stats);
        return { _id: e._id, title: e.title, destination: e.destination, startDate: e.startDate, endDate: e.endDate, pricePerPerson: e.priceFrom, seatsLeft: w.seatsLeft, durationDays: e.durationDays, durationNights: e.durationNights, photo: (e.photos || [])[0] || '' };
      }),
      reviews: reviews.map(r => ({ _id: r._id, rating: r.rating, comment: r.comment, createdAt: r.createdAt, author: userCard(r.user) })),
      announcements
    }
  });
});

// ---------- The wall ----------

const wallPostsOf = agencyId => ({ byAgency: agencyId, status: 'active', audience: 'public' });

const findActiveAgency = async id => {
  const agency = validId(id) ? await Agency.findOne({ _id: id, status: 'active' }).select('pinnedPost').lean() : null;
  if (!agency) throw new AppError('This agency is not available.', 404);
  return agency;
};

/**
 * GET /agencies/:id/posts?cursor&limit
 * Newest first, with the pinned post at the top of the first page.
 */
exports.wallPosts = catchAsync(async (req, res) => {
  const agency = await findActiveAgency(req.params.id);
  const ctx = await viewerContext(req.user);
  const limit = pageSize(req.query);
  const filter = { ...wallPostsOf(agency._id), ...cursorFilter(req.query.cursor) };
  if (agency.pinnedPost) filter._id = { $ne: agency.pinnedPost };
  const [rows, pinned] = await Promise.all([
    Post.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).populate(POPULATE),
    agency.pinnedPost && !req.query.cursor ? Post.findOne({ ...wallPostsOf(agency._id), _id: agency.pinnedPost }).populate(POPULATE) : null
  ]);
  const posts = await hydratePosts(pinned ? [pinned, ...rows] : rows, ctx);
  const pinnedId = String(agency.pinnedPost);
  res.status(200).json({ status: 'success', data: { posts: posts.map(p => ({ ...p, pinned: String(p._id) === pinnedId })), nextCursor: nextCursor(rows, limit) } });
});

/**
 * GET /agencies/:id/media?type=image|video&cursor&limit
 * Every photo and video on the wall, for the profile's grid. A page holds the media of `limit` posts,
 * and each item names its post, so tapping it can open /posts/:id.
 */
exports.wallMedia = catchAsync(async (req, res) => {
  const agency = await findActiveAgency(req.params.id);
  const type = ['image', 'video'].includes(req.query.type) ? req.query.type : null;
  const limit = pageSize(req.query);
  const rows = await Post.find({ ...wallPostsOf(agency._id), ...cursorFilter(req.query.cursor), ...(type ? { 'media.type': type } : { 'media.0': { $exists: true } }) })
    .sort({ createdAt: -1, _id: -1 }).limit(limit).select('media text createdAt').lean();
  const media = rows.flatMap(p => p.media
    .filter(m => !type || m.type === type)
    .map(m => ({ ...m, post: p._id, caption: snippet(p.text), postedAt: p.createdAt })));
  res.status(200).json({ status: 'success', data: { media, nextCursor: nextCursor(rows, limit) } });
});

exports.follow = catchAsync(async (req, res, next) => {
  const agency = validId(req.params.id) ? await Agency.findOne({ _id: req.params.id, status: 'active', kind: { $ne: 'hotel' } }).select('name') : null;
  if (!agency) return next(new AppError('This agency is not available.', 404));
  await Follow.updateOne({ follower: req.user._id, targetType: 'agency', target: agency._id }, { $setOnInsert: { follower: req.user._id, targetType: 'agency', target: agency._id } }, { upsert: true });
  res.status(200).json({ status: 'success', message: `You're following ${agency.name}. Their new tours show up for you first.`, data: { following: true } });
});

exports.unfollow = catchAsync(async (req, res) => {
  if (validId(req.params.id)) await Follow.deleteOne({ follower: req.user._id, targetType: 'agency', target: req.params.id });
  res.status(200).json({ status: 'success', data: { following: false } });
});
