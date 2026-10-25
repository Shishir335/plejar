const Destination = require('../models/destinationModel');
const DestinationCategory = require('../models/destinationCategoryModel');
const Package = require('../models/packageModel');
const Agency = require('../models/agencyModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { escapeRegex, pageParams, paged, validId, toId } = require('../utils/query');
const { rollupStats, statsOf, trendingScore, pathNames } = require('../utils/destinations');
const { registrationStats, withStats } = require('../utils/events');

// For the mobile app and website: published destinations only

const CARD_FIELDS = 'name nameBn slug type parent ancestors summary coverImage location availability categories bestMonths featured';

const card = (d, stats, pathOf) => ({
  _id: d._id,
  name: d.name,
  nameBn: d.nameBn,
  slug: d.slug,
  type: d.type,
  summary: d.summary,
  coverImage: d.coverImage,
  location: d.location && d.location.coordinates && d.location.coordinates.length === 2
    ? { lat: d.location.coordinates[1], lng: d.location.coordinates[0] }
    : null,
  availability: d.availability,
  bestMonths: d.bestMonths,
  categories: d.categories,
  path: pathOf ? pathOf(d) : [],
  upcomingEvents: statsOf(stats, d._id).upcomingEvents
});

// Destinations to browse. Filters: type, parent, within, category, featured, trending, near (lat,lng) + radiusKm, q.
exports.listDestinations = catchAsync(async (req, res, next) => {
  const q = req.query;
  const filter = { status: 'published' };
  if (Destination.TYPES.includes(q.type)) filter.type = q.type;
  if (validId(q.parent)) filter.parent = toId(q.parent);
  if (validId(q.within)) filter.ancestors = toId(q.within);
  if (validId(q.category)) filter.categories = toId(q.category);
  if (q.featured === 'true') filter.featured = true;
  if (q.q) {
    const rx = { $regex: escapeRegex(String(q.q).trim()), $options: 'i' };
    filter.$or = [{ name: rx }, { nameBn: rx }, { summary: rx }];
  }
  if (q.near) {
    const [lat, lng] = String(q.near).split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return next(new AppError('Use near=latitude,longitude, for example near=23.81,90.41.', 400));
    const km = Math.min(Math.max(Number(q.radiusKm) || 100, 1), 1000);
    filter.location = { $geoWithin: { $centerSphere: [[lng, lat], km / 6378.1] } };
  }

  const page = pageParams(q);
  let rows;
  let total;
  let stats;
  if (q.trending === 'true') {
    [rows, stats] = await Promise.all([Destination.find(filter).select(`${CARD_FIELDS} trendingPinned views`).populate('categories', 'name nameBn').lean(), rollupStats()]);
    rows = rows.map(r => ({ r, s: trendingScore(r, statsOf(stats, r._id)) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.r);
    total = rows.length;
    rows = rows.slice(page.skip, page.skip + page.limit);
  } else {
    const sort = q.featured === 'true' ? { featuredOrder: 1, name: 1 } : { name: 1 };
    [rows, total, stats] = await Promise.all([
      Destination.find(filter).sort(sort).skip(page.skip).limit(page.limit).select(CARD_FIELDS).populate('categories', 'name nameBn').lean(),
      Destination.countDocuments(filter),
      rollupStats()
    ]);
  }
  const pathOf = await pathNames(rows);
  res.status(200).json({ status: 'success', data: { destinations: rows.map(r => card(r, stats, pathOf)), ...paged(total, page) } });
});

// One destination by its web address (slug) or ID, with the places inside it and upcoming tour events there
exports.getDestination = catchAsync(async (req, res, next) => {
  const key = String(req.params.slug || '').toLowerCase();
  const match = validId(key) ? { _id: key } : { slug: key };
  const dest = await Destination.findOneAndUpdate({ ...match, status: 'published' }, { $inc: { views: 1 } }, { new: true })
    .select('-createdBy -updatedBy -featuredOrder -trendingPinned -views')
    .populate('categories', 'name nameBn')
    .lean();
  if (!dest) return next(new AppError('That destination is not available.', 404));

  const subtree = [dest._id, ...(await Destination.find({ ancestors: dest._id, status: 'published' }).select('_id').lean()).map(d => d._id)];
  const activeAgencies = (await Agency.find({ status: 'active' }).select('_id').lean()).map(a => a._id);
  const [ancestors, children, events, stats] = await Promise.all([
    Destination.find({ _id: { $in: dest.ancestors }, status: 'published' }).select('name slug type').lean(),
    Destination.find({ parent: dest._id, status: 'published' }).sort({ name: 1 }).select(CARD_FIELDS).lean(),
    Package.find({ destinationRef: { $in: subtree }, status: 'published', startDate: { $gte: new Date() }, agency: { $in: activeAgencies } })
      .sort({ startDate: 1 }).limit(10).populate('agency', 'name logo verified')
      .select('title destination startDate endDate priceFrom seats photos agency registrationDeadline').lean(),
    rollupStats()
  ]);
  const order = new Map(dest.ancestors.map((id, i) => [String(id), i]));
  const evStats = await registrationStats(events.map(e => e._id));

  res.status(200).json({
    status: 'success',
    data: {
      destination: {
        ...dest,
        ancestors: undefined,
        location: card(dest).location,
        path: ancestors.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)))
      },
      children: children.map(c => card(c, stats)),
      upcomingEvents: events.map(e => {
        const w = withStats(e, evStats);
        return { _id: e._id, title: e.title, startDate: e.startDate, endDate: e.endDate, pricePerPerson: e.priceFrom, seatsLeft: w.seatsLeft, photo: e.photos[0] || '', agency: e.agency };
      })
    }
  });
});

exports.listCategories = catchAsync(async (req, res) => {
  const categories = await DestinationCategory.find({ active: true }).sort({ name: 1 }).select('name nameBn description').lean();
  res.status(200).json({ status: 'success', data: { categories } });
});
