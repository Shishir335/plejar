const mongoose = require('mongoose');
const { cancelRefundView } = require('../utils/cancelRefund');
const paymentConfig = require('../utils/payments/config');
const Package = require('../models/packageModel');
const Agency = require('../models/agencyModel');
const Destination = require('../models/destinationModel');
const Hotel = require('../models/hotelModel');
const Promotion = require('../models/promotionModel');
const TourSearch = require('../models/tourSearchModel');
const RecentView = require('../models/recentViewModel');
const Wishlist = require('../models/wishlistModel');
const Notification = require('../models/notificationModel');
const Review = require('../models/reviewModel');
const Booking = require('../models/bookingModel');
const { ChatRoom } = require('../models/chatModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { escapeRegex, pageParams, paged } = require('../utils/query');
const { registrationStats } = require('../utils/events');
const { AGENCY_CARD, PLACE_POPULATE, placeView, tourContext, popularityScore, tourCard, hotelCard, savedSet } = require('../utils/tourCards');
const { publicEvent } = require('./travelerController');
const { nearbyHotels } = require('./hotelController');
const { bannerView, liveBanners } = require('./promotionController');
const { publicGuide } = require('./guideController');
const { userCard } = require('../utils/social');
const { HOLDS_SEAT } = require('../utils/events');
const { pointsPerTaka } = require('../utils/rewards');

// The app's Tours tab: the home screen in one call, search with filters, a tour's page,
// hearts (wishlist), recently viewed and "Continue Your Search"

const validId = id => mongoose.isValidObjectId(id);
const MAX_MATCHES = 500; // upcoming tours considered per search (plenty for Bangladesh-wide listings)
const RECENT_KEEP = 20;
const SEARCHES_KEEP = 10;

const TYPE_LABELS = {
  group: 'Group Tour',
  private: 'Private Tour',
  family: 'Family Tour',
  couple: 'Couple Tour',
  solo: 'Solo Trip',
  corporate: 'Corporate Tour'
};

const TAG_LABELS = Object.fromEntries(Package.TOUR_TAGS.map(t => [t, t.charAt(0).toUpperCase() + t.slice(1)]));

const SORTS = ['popular', 'price_asc', 'price_desc', 'soonest', 'rating', 'newest', 'discount'];

const activeAgencyIds = async () => (await Agency.find({ status: 'active' }).select('_id').lean()).map(a => a._id);

// Bookable tours: published, not started, run by an active agency
const baseFilter = async () => ({ status: 'published', startDate: { $gt: new Date() }, agency: { $in: await activeAgencyIds() } });

const toObjectId = id => new mongoose.Types.ObjectId(String(id));

const withSubtree = async destinationId => {
  const inside = await Destination.find({ ancestors: destinationId }).select('_id').lean();
  return [toObjectId(destinationId), ...inside.map(d => d._id)];
};

const num = v => (v === undefined || v === '' || v === null || Number.isNaN(Number(v)) ? null : Number(v));
// YYYY-MM-DD (or any date) from the query string; something that isn't a date is an error
const day = (v, label = 'date') => {
  if (v === undefined || v === null || v === '') return null;
  // Tour dates are stored as the calendar day at 00:00 UTC, so a plain day is read the same way
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) throw new AppError(`Enter the ${label} as YYYY-MM-DD.`, 400);
  return d;
};
const DAY_MS = 86400000;

/** Read the search from the query string. Throws AppError on bad input. */
/** Read the search from the query string. Throws AppError on bad input. */
const readSearch = q => {
  const s = {
    query: String(q.q || '').trim().slice(0, 120),
    tourType: q.type && q.type !== 'all' ? String(q.type) : '',
    // "Theme" in the filter panel: one tag or several (any of them), as tag= or theme=
    tags: [...new Set([].concat(q.tag || [], q.theme || []).flatMap(v => String(v).split(',')).map(t => t.trim().toLowerCase()).filter(t => t && t !== 'any'))],
    destination: q.destination && q.destination !== 'any' ? String(q.destination) : '',
    // One day: tours running on that day. Or a range with from/to: tours starting inside it.
    date: day(q.date),
    from: day(q.from, 'start of the date range'),
    to: day(q.to, 'end of the date range'),
    adults: num(q.adults),
    children: num(q.children),
    minPrice: num(q.minPrice),
    maxPrice: num(q.maxPrice),
    minDays: num(q.minDays),
    maxDays: num(q.maxDays),
    difficulty: q.difficulty ? String(q.difficulty) : '',
    minRating: num(q.minRating),
    onSale: q.onSale === 'true',
    agency: q.agency || '',
    promotion: q.promotion || '',
    sort: SORTS.includes(q.sort) ? q.sort : 'popular'
  };
  if ([s.minPrice, s.maxPrice].some(n => n !== null && n < 0)) throw new AppError('Prices start at 0.', 400);
  if (s.minPrice !== null && s.maxPrice !== null && s.minPrice > s.maxPrice) throw new AppError('The lowest price is higher than the highest. Swap them and try again.', 400);
  if (s.from && s.to && s.from > s.to) throw new AppError('The date range ends before it starts.', 400);
  const unknown = s.tags.find(t => !Package.TOUR_TAGS.includes(t));
  if (unknown) throw new AppError(`Unknown theme "${unknown}".`, 400);
  return s;
};

// Did the traveler narrow anything down (beyond the tour type)?
const hasFilters = s => Boolean(s.query || s.tags.length || s.destination || s.date || s.from || s.to || s.minPrice !== null || s.maxPrice !== null
  || s.minDays !== null || s.maxDays !== null || s.difficulty || s.minRating !== null || s.onSale || s.adults || s.children || s.agency || s.promotion);

const guestsOf = s => (s.adults || 0) + (s.children || 0) || null;

// What a promotion's "Explore Now" shows
const promotionFilter = async id => {
  const promo = validId(id) ? await Promotion.findOne({ _id: id, ...Promotion.liveFilter() }).lean() : null;
  if (!promo) throw new AppError('This offer has ended.', 404);
  if (promo.target === 'tours') return { _id: { $in: promo.tours || [] } };
  if (promo.target === 'destination' && promo.destination) return { destinationRef: { $in: await withSubtree(promo.destination) } };
  if (promo.target === 'agency' && promo.agency) return { agency: promo.agency };
  if (promo.target === 'tour_type' && promo.tourType) return { tourType: promo.tourType };
  // Tours on sale, at least minDiscount percent off
  const ratio = 1 - (promo.minDiscount || 0) / 100;
  return { $expr: { $and: [{ $gt: ['$regularPrice', '$priceFrom'] }, { $lte: ['$priceFrom', { $multiply: ['$regularPrice', ratio] }] }] } };
};

const mongoFilter = async s => {
  if (s.tourType && !Package.TOUR_TYPES.includes(s.tourType)) throw new AppError('Unknown tour type.', 400);
  if (s.destination && !validId(s.destination)) throw new AppError('Unknown destination.', 400);
  if (s.agency && !validId(s.agency)) throw new AppError('Unknown agency.', 400);
  const filter = await baseFilter();
  if (s.tourType) filter.tourType = s.tourType;
  if (s.tags.length) filter.tags = { $in: s.tags };
  if (s.agency) filter.agency = { $in: filter.agency.$in.filter(a => String(a) === String(s.agency)) };
  if (s.destination) filter.destinationRef = { $in: await withSubtree(s.destination) };
  if (s.from) filter.startDate.$gte = new Date(Math.max(s.from.getTime(), Date.now()));
  if (s.to) filter.startDate.$lte = new Date(s.to.getTime() + DAY_MS - 1);
  if (s.date) {
    // Running that day: starts on or before it and ends on or after it
    filter.startDate.$lte = filter.startDate.$lte && filter.startDate.$lte < s.date ? filter.startDate.$lte : s.date;
    filter.$and = (filter.$and || []).concat({ $or: [{ endDate: { $gte: s.date } }, { endDate: null, startDate: { $gte: s.date } }] });
  }
  if (s.minPrice != null || s.maxPrice != null) {
    filter.priceFrom = {};
    if (s.minPrice != null) filter.priceFrom.$gte = s.minPrice;
    if (s.maxPrice != null) filter.priceFrom.$lte = s.maxPrice;
  }
  if (s.minDays != null || s.maxDays != null) {
    filter.durationDays = {};
    if (s.minDays != null) filter.durationDays.$gte = s.minDays;
    if (s.maxDays != null) filter.durationDays.$lte = s.maxDays;
  }
  if (s.difficulty) filter.difficulty = s.difficulty;
  if (s.onSale) filter.$and = (filter.$and || []).concat({ $expr: { $gt: ['$regularPrice', '$priceFrom'] } });
  if (s.query) {
    const rx = { $regex: escapeRegex(s.query), $options: 'i' };
    const places = await Destination.find({ status: 'published', $or: [{ name: rx }, { nameBn: rx }] }).select('_id').limit(50).lean();
    const placeIds = places.length ? (await Promise.all(places.map(p => withSubtree(p._id)))).flat() : [];
    filter.$or = [{ title: rx }, { destination: rx }, { highlights: rx }, ...(placeIds.length ? [{ destinationRef: { $in: placeIds } }] : [])];
  }
  if (s.promotion) filter.$and = (filter.$and || []).concat(await promotionFilter(s.promotion));
  return filter;
};

const loadTours = (filter, limit = MAX_MATCHES) => Package.find(filter)
  .sort({ startDate: 1 }).limit(limit)
  .populate('agency', AGENCY_CARD)
  .populate(PLACE_POPULATE);

/** Filter and sort matches that need computed numbers (seats left, rating, popularity) */
const rank = (tours, ctx, s) => {
  const guests = guestsOf(s);
  let rows = tours.map(t => ({ tour: t, card: tourCard(t, ctx), score: popularityScore(t, ctx) }));
  if (guests) {
    rows = rows.filter(r => (r.card.seatsLeft === null || r.card.seatsLeft >= guests)
      && (!r.card.groupSize || !r.card.groupSize.max || r.card.groupSize.max >= guests));
  }
  if (s.minRating != null) rows = rows.filter(r => r.card.rating.average != null && r.card.rating.average >= s.minRating);
  const by = {
    popular: (a, b) => b.score - a.score,
    price_asc: (a, b) => a.card.price.amount - b.card.price.amount,
    price_desc: (a, b) => b.card.price.amount - a.card.price.amount,
    soonest: (a, b) => new Date(a.card.startDate) - new Date(b.card.startDate),
    rating: (a, b) => (b.card.rating.average || 0) - (a.card.rating.average || 0) || b.card.rating.count - a.card.rating.count,
    newest: (a, b) => b.tour.createdAt - a.tour.createdAt,
    discount: (a, b) => b.card.price.discountPercent - a.card.price.discountPercent
  }[s.sort];
  return rows.sort((a, b) => by(a, b) || new Date(a.card.startDate) - new Date(b.card.startDate)).map(r => r.card);
};

// ---------- Searches ("Continue Your Search") ----------

const searchKey = s => JSON.stringify([s.query.toLowerCase(), s.tourType, s.tags.join(','), s.date && s.date.toISOString().slice(0, 10), String(s.destination || ''), s.from && s.from.toISOString().slice(0, 10), s.to && s.to.toISOString().slice(0, 10), s.adults, s.children, s.minPrice, s.maxPrice, s.minDays, s.maxDays, s.difficulty, s.minRating, s.onSale]);

const worthSaving = s => Boolean(s.query || s.destination || s.from || s.to || s.date || s.tags.length);

const rememberSearch = async (user, s, resultCount) => {
  const key = searchKey(s);
  await TourSearch.updateOne(
    { user: user._id, key },
    {
      $set: {
        query: s.query,
        tourType: s.tourType,
        destination: validId(s.destination) ? s.destination : undefined,
        from: s.from || undefined,
        to: s.to || undefined,
        adults: s.adults,
        children: s.children,
        filters: { theme: s.tags.length ? s.tags.join(',') : null, date: s.date ? s.date.toISOString().slice(0, 10) : null, minPrice: s.minPrice, maxPrice: s.maxPrice, minDays: s.minDays, maxDays: s.maxDays, difficulty: s.difficulty || null, minRating: s.minRating, onSale: s.onSale || null },
        resultCount,
        searchedAt: new Date()
      }
    },
    { upsert: true }
  );
  const old = await TourSearch.find({ user: user._id }).sort({ searchedAt: -1 }).skip(SEARCHES_KEEP).select('_id').lean();
  if (old.length) await TourSearch.deleteMany({ _id: { $in: old.map(o => o._id) } });
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "1 - 3 July, 2 adults"
const searchSummary = s => {
  const parts = [];
  const d = x => new Date(x);
  if (s.from && s.to) {
    const a = d(s.from);
    const b = d(s.to);
    parts.push(a.getUTCMonth() === b.getUTCMonth()
      ? `${a.getUTCDate()} - ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
      : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} - ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`);
  } else if (s.from) parts.push(`From ${d(s.from).getUTCDate()} ${MONTHS[d(s.from).getUTCMonth()]}`);
  const f = s.filters || {};
  if (!s.from && f.date) parts.push(`${d(f.date).getUTCDate()} ${MONTHS[d(f.date).getUTCMonth()]}`);
  const people = [s.adults ? `${s.adults} adult${s.adults > 1 ? 's' : ''}` : null, s.children ? `${s.children} child${s.children > 1 ? 'ren' : ''}` : null].filter(Boolean).join(', ');
  if (people) parts.push(people);
  const taka = n => Number(n).toLocaleString('en-US');
  if (f.minPrice != null && f.maxPrice != null) parts.push(`BDT ${taka(f.minPrice)} - ${taka(f.maxPrice)}`);
  else if (f.maxPrice != null) parts.push(`Up to BDT ${taka(f.maxPrice)}`);
  else if (f.minPrice != null) parts.push(`From BDT ${taka(f.minPrice)}`);
  return parts.join(', ');
};

// "Beach & Island tours" for a search by theme only
const themeTitle = theme => {
  const labels = String(theme || '').split(',').filter(Boolean).map(t => TAG_LABELS[t] || t);
  return labels.length ? `${labels.join(' & ')} tours` : null;
};

const searchView = (row, photo) => ({
  _id: row._id,
  title: row.query || (row.destination && row.destination.name) || themeTitle(row.filters && row.filters.theme) || TYPE_LABELS[row.tourType] || 'Tours',
  summary: searchSummary(row),
  photo: photo || (row.destination && row.destination.coverImage) || '',
  // Pass these back to GET /tours to run the search again
  params: Object.fromEntries(Object.entries({
    q: row.query || undefined,
    type: row.tourType || undefined,
    destination: row.destination ? String(row.destination._id || row.destination) : undefined,
    from: row.from ? row.from.toISOString().slice(0, 10) : undefined,
    to: row.to ? row.to.toISOString().slice(0, 10) : undefined,
    adults: row.adults || undefined,
    children: row.children || undefined,
    ...Object.fromEntries(Object.entries(row.filters || {}).filter(([, v]) => v !== null && v !== undefined))
  }).filter(([, v]) => v !== undefined)),
  resultCount: row.resultCount,
  searchedAt: row.searchedAt
});

const recentSearches = async (user, limit = SEARCHES_KEEP) => {
  const rows = await TourSearch.find({ user: user._id }).sort({ searchedAt: -1 }).limit(limit).populate('destination', 'name coverImage').lean();
  // A photo for searches without a destination photo: the first tour that matched by name
  return Promise.all(rows.map(async row => {
    let photo = row.destination && row.destination.coverImage;
    if (!photo && row.query) {
      const tour = await Package.findOne({ status: 'published', title: { $regex: escapeRegex(row.query), $options: 'i' }, 'photos.0': { $exists: true } }).select('photos').lean();
      photo = tour && tour.photos[0];
    }
    const theme = row.filters && row.filters.theme;
    if (!photo && theme) {
      const tour = await Package.findOne({ status: 'published', tags: { $in: String(theme).split(',') }, 'photos.0': { $exists: true } }).select('photos').lean();
      photo = tour && tour.photos[0];
    }
    return searchView(row, photo);
  }));
};

exports.listSearches = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: { searches: await recentSearches(req.user) } });
});

exports.deleteSearch = catchAsync(async (req, res) => {
  if (validId(req.params.id)) await TourSearch.deleteOne({ _id: req.params.id, user: req.user._id });
  res.status(204).json({ status: 'success', data: null });
});

exports.clearSearches = catchAsync(async (req, res) => {
  await TourSearch.deleteMany({ user: req.user._id });
  res.status(204).json({ status: 'success', data: null });
});

// ---------- Tour types and filters ----------

const typeCounts = async () => {
  const rows = await Package.aggregate([{ $match: await baseFilter() }, { $group: { _id: '$tourType', count: { $sum: 1 } } }]);
  const counts = new Map(rows.map(r => [r._id || 'group', r.count]));
  return [
    { value: 'all', label: 'All Tours', count: rows.reduce((n, r) => n + r.count, 0) },
    ...Package.TOUR_TYPES.map(t => ({ value: t, label: TYPE_LABELS[t], count: counts.get(t) || 0 }))
  ];
};

exports.types = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: { types: await typeCounts() } });
});

/**
 * Places that have bookable tours, as an indented list for the Destination dropdown:
 * each division, then its districts, then the places inside, with how many tours each has.
 */
const locationOptions = async match => {
  const rows = await Package.aggregate([{ $match: { ...match, destinationRef: { $ne: null } } }, { $group: { _id: '$destinationRef', count: { $sum: 1 } } }]);
  if (!rows.length) return [];
  const places = await Destination.find({ _id: { $in: rows.map(r => r._id) }, status: 'published' }).select('name type ancestors').lean();
  const counts = new Map();
  places.forEach(p => {
    const n = rows.find(r => String(r._id) === String(p._id)).count;
    [p._id, ...(p.ancestors || [])].forEach(id => counts.set(String(id), (counts.get(String(id)) || 0) + n));
  });
  const all = await Destination.find({ _id: { $in: [...counts.keys()] }, status: 'published' }).select('name type parent ancestors').lean();
  const byParent = new Map();
  all.forEach(d => {
    const key = String(d.parent || 'root');
    byParent.set(key, (byParent.get(key) || []).concat(d));
  });
  // Depth-first so each division is followed by its districts and places; `path` is the shown parents
  const out = [];
  const onlyOneCountry = (byParent.get('root') || []).length === 1;
  const walk = (parentKey, depth, path) => {
    (byParent.get(parentKey) || []).sort((a, b) => a.name.localeCompare(b.name)).forEach(d => {
      const hide = d.type === 'country' && onlyOneCountry;
      // "Place, District" like the rest of the app
      if (!hide) out.push({ _id: d._id, name: d.name, type: d.type, depth, label: [d.name, path[path.length - 1]].filter(Boolean).join(', '), count: counts.get(String(d._id)) });
      walk(String(d._id), hide ? depth : depth + 1, hide ? path : [...path, d.name]);
    });
  };
  walk('root', 0, []);
  return out;
};

// A round range for the price boxes ("0 - 5000")
const priceRange = (min, max) => {
  const step = max > 20000 ? 1000 : 500;
  return { currency: 'BDT', min: min || 0, max: max || 0, suggestedMin: Math.floor((min || 0) / step) * step, suggestedMax: Math.ceil((max || 0) / step) * step, step };
};

// GET /tours/filters?type= — everything the filter panel offers, from tours that are actually bookable
exports.filters = catchAsync(async (req, res) => {
  const match = await baseFilter();
  const type = req.query.type && req.query.type !== 'all' ? String(req.query.type) : '';
  if (type && !Package.TOUR_TYPES.includes(type)) throw new AppError('Unknown tour type.', 400);
  if (type) match.tourType = type;
  const [prices, durations, difficulties, highlights, places, types, tags, locations, total] = await Promise.all([
    Package.aggregate([{ $match: match }, { $group: { _id: null, min: { $min: '$priceFrom' }, max: { $max: '$priceFrom' }, firstStart: { $min: '$startDate' }, lastEnd: { $max: { $ifNull: ['$endDate', '$startDate'] } } } }]),
    Package.aggregate([{ $match: match }, { $group: { _id: '$durationDays', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Package.aggregate([{ $match: { ...match, difficulty: { $ne: null } } }, { $group: { _id: '$difficulty', count: { $sum: 1 } } }]),
    Package.aggregate([{ $match: match }, { $unwind: '$highlights' }, { $group: { _id: '$highlights', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 15 }]),
    Package.aggregate([{ $match: { ...match, destinationRef: { $ne: null } } }, { $group: { _id: '$destinationRef', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 30 }]),
    typeCounts(),
    Package.aggregate([{ $match: match }, { $unwind: '$tags' }, { $group: { _id: '$tags', count: { $sum: 1 } } }]),
    locationOptions(match),
    Package.countDocuments(match)
  ]);
  const placeDocs = await Destination.find({ _id: { $in: places.map(p => p._id) }, status: 'published' }).populate('ancestors', 'name type').select('name type status ancestors').lean();
  const byId = new Map(placeDocs.map(p => [String(p._id), p]));
  const tagCount = new Map(tags.map(t => [t._id, t.count]));
  const themes = Package.TOUR_TAGS.map(t => ({ value: t, label: TAG_LABELS[t], count: tagCount.get(t) || 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const ymd = d => (d ? new Date(d).toISOString().slice(0, 10) : null);
  res.status(200).json({
    status: 'success',
    data: {
      types,
      // The filter panel: Destination, Theme, Date, Price Range
      locations: [{ _id: 'any', name: 'Any Location', label: 'Any Location', depth: 0, count: total }, ...locations],
      themes: [{ value: 'any', label: 'Any Theme', count: total }, ...themes],
      dates: { earliest: prices[0] ? ymd(prices[0].firstStart) : null, latest: prices[0] ? ymd(prices[0].lastEnd) : null },
      price: priceRange(prices[0] && prices[0].min, prices[0] && prices[0].max),
      // More filters
      durations: durations.map(d => ({ days: d._id, count: d.count })),
      difficulties: difficulties.map(d => ({ value: d._id, count: d.count })),
      highlights: highlights.map(h => ({ value: h._id, count: h.count })),
      tags: themes.filter(t => t.count).map(({ value, label, count }) => ({ value, label, count })),
      destinations: places.map(p => byId.get(String(p._id)) && { ...placeView(byId.get(String(p._id))), count: p.count }).filter(Boolean),
      sorts: [
        { value: 'popular', label: 'Most popular' },
        { value: 'soonest', label: 'Starting soonest' },
        { value: 'price_asc', label: 'Price: low to high' },
        { value: 'price_desc', label: 'Price: high to low' },
        { value: 'rating', label: 'Top rated' },
        { value: 'discount', label: 'Biggest discount' },
        { value: 'newest', label: 'Newly added' }
      ]
    }
  });
});

// ---------- Search ----------

/**
 * GET /tours?q&type&destination&from&to&adults&children&minPrice&maxPrice&minDays&maxDays
 *          &difficulty&minRating&onSale=true&agency&promotion&sort&page&limit
 * Signed-in searches with a place, words or dates are remembered for "Continue Your Search".
 */
exports.listTours = catchAsync(async (req, res) => {
  const s = readSearch(req.query);
  const tours = await loadTours(await mongoFilter(s));
  const ctx = await tourContext(tours, req.user);
  const cards = rank(tours, ctx, s);
  const page = pageParams(req.query);
  if (s.promotion && page.page === 1) await Promotion.updateOne({ _id: s.promotion }, { $inc: { clicks: 1 } });
  if (req.user && page.page === 1 && worthSaving(s) && req.query.remember !== 'false') await rememberSearch(req.user, s, cards.length);
  res.status(200).json({ status: 'success', data: { tours: cards.slice(page.skip, page.skip + page.limit), ...paged(cards.length, page) } });
});

// ---------- One tour ----------

const remember = async (user, kind, item) => {
  if (!user) return;
  await RecentView.updateOne({ user: user._id, kind, item }, { $set: { viewedAt: new Date() } }, { upsert: true });
  const old = await RecentView.find({ user: user._id }).sort({ viewedAt: -1 }).skip(RECENT_KEEP).select('_id').lean();
  if (old.length) await RecentView.deleteMany({ _id: { $in: old.map(o => o._id) } });
};
exports.remember = remember;

const reviewView = r => ({ _id: r._id, rating: r.rating, comment: r.comment, createdAt: r.createdAt, author: userCard(r.user) });

/** Average, count and how many of each star, for a tour's visible reviews */
const reviewSummary = async tourId => {
  const rows = await Review.aggregate([
    { $match: { package: tourId, status: 'visible' } },
    { $group: { _id: '$rating', count: { $sum: 1 } } }
  ]);
  const count = rows.reduce((n, r) => n + r.count, 0);
  const total = rows.reduce((n, r) => n + r._id * r.count, 0);
  const breakdown = Object.fromEntries([5, 4, 3, 2, 1].map(star => [star, (rows.find(r => r._id === star) || { count: 0 }).count]));
  return { average: count ? Math.round((total / count) * 10) / 10 : null, count, breakdown };
};

// When the tour leaves: the start date at the departure time, Bangladesh time
const departsAt = tour => {
  if (!tour.startDate) return null;
  const date = new Date(tour.startDate).toISOString().slice(0, 10);
  return new Date(`${date}T${tour.departureTime || '00:00'}:00+06:00`);
};

/**
 * GET /tours/:id — everything on the tour page: the hero (photos, place, tags), the four facts
 * (duration, group size, start date, price), the Itinerary / Details / Tour Guide / Reviews tabs,
 * the "Book This Tour" box, the trip countdown and the "Message Tour Guide" thread.
 */
exports.getTour = catchAsync(async (req, res, next) => {
  const tour = validId(req.params.id)
    ? await Package.findOne({ _id: req.params.id, status: { $in: ['published', 'cancelled'] } })
      .populate('agency', `${AGENCY_CARD} regions`).populate(PLACE_POPULATE).populate('itinerary.stops.destinationRef', 'name slug status')
      .populate('guide')
    : null;
  if (!tour || !tour.agency || tour.agency.status !== 'active') return next(new AppError('This tour is not available.', 404));
  // Opened from a vendor's ad: count the tap
  if (validId(req.query.promotion)) await Promotion.updateOne({ _id: req.query.promotion, source: 'vendor', tour: tour._id }, { $inc: { clicks: 1 } });
  const [ctx, stats, reviews, latest, myBooking, chat] = await Promise.all([
    tourContext([tour], req.user),
    registrationStats([tour._id]),
    reviewSummary(tour._id),
    Review.find({ package: tour._id, status: 'visible' }).sort({ createdAt: -1 }).limit(5).populate('user', 'name photo verification.status status role').lean(),
    req.user ? Booking.findOne({ user: req.user._id, package: tour._id, status: { $in: HOLDS_SEAT } }).select('reference status travelers amount travelDate').lean() : null,
    // The chat "Message Tour Guide" opens: with the tour's guide, or with the agency
    req.user ? ChatRoom.findOne({ key: tour.guide && tour.guide.active ? `guide:${tour.guide._id}:${req.user._id}` : `agency:${tour.agency._id}:${req.user._id}` }).lean() : null
  ]);
  const detail = publicEvent(tour, stats);
  if (tour.status === 'cancelled') Object.assign(detail, { cancelled: true, cancelReason: tour.cancelReason, registrationOpen: false, registrationClosedReason: 'This tour was cancelled.' });
  const card = tourCard(tour, ctx);
  const maxTravelers = Math.min(50, ...[card.seatsLeft, tour.groupSize && tour.groupSize.max].filter(n => n !== null && n !== undefined));
  const leaves = departsAt(tour);
  const shareUrl = `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/tours/${tour._id}`;

  await Promise.all([Package.updateOne({ _id: tour._id }, { $inc: { viewCount: 1 } }), remember(req.user, 'tour', tour._id)]);
  res.status(200).json({
    status: 'success',
    data: {
      tour: {
        ...detail,
        ...card,
        tags: (tour.tags || []).map(t => ({ value: t, label: TAG_LABELS[t] || t })),
        facts: {
          durationDays: tour.durationDays,
          durationNights: tour.durationNights,
          groupSizeMax: tour.groupSize && tour.groupSize.max ? tour.groupSize.max : tour.seats || null,
          startDate: tour.startDate,
          price: card.price
        },
        guide: publicGuide(tour.guide && tour.guide.active ? tour.guide : null),
        reviews: { ...reviews, latest: latest.filter(r => r.user && r.user.status === 'active').map(reviewView) },
        // "Book This Tour": request with POST /bookings { packageId, travelers }. With bookingMoney, add
        // payWith (one of paymentMethods) and pay at the redirectUrl that comes back before it's booked.
        booking: {
          price: card.price,
          bookingMoney: tour.advanceAmount >= 1 ? { perTraveler: Math.round(tour.advanceAmount), cancelRefund: cancelRefundView(tour) } : null,
          paymentMethods: paymentConfig.enabledMethods(),
          minTravelers: 1,
          maxTravelers: Math.max(maxTravelers, 0),
          dates: { start: tour.startDate, end: tour.endDate || tour.startDate, flexible: Boolean(tour.flexibleDates) },
          open: detail.registrationOpen,
          closedReason: detail.registrationClosedReason,
          mine: myBooking ? { _id: myBooking._id, reference: myBooking.reference, status: myBooking.status, travelers: myBooking.travelers, amount: myBooking.amount } : null
        },
        countdown: { departsAt: leaves, started: leaves ? leaves <= new Date() : false },
        share: { url: shareUrl, text: `${tour.title}${card.location ? ` in ${card.location}` : ''}: ${card.durationDays} days from BDT ${card.price.amount} on Plejar` },
        // "Message Tour Guide": POST /tours/:id/messages, then continue in the chat (/chats/:chatId)
        contact: {
          with: tour.guide && tour.guide.active ? 'guide' : 'agency',
          chatId: chat ? chat._id : null,
          unread: chat ? ((chat.members || []).find(m => String(m.user) === String(req.user._id)) || {}).unread || 0 : 0
        }
      }
    }
  });
});

// GET /tours/:id/reviews?page — the Reviews tab, newest first
exports.tourReviews = catchAsync(async (req, res, next) => {
  if (!validId(req.params.id) || !(await Package.exists({ _id: req.params.id, status: { $in: ['published', 'cancelled'] } }))) return next(new AppError('This tour is not available.', 404));
  const tourId = toObjectId(req.params.id);
  const filter = { package: tourId, status: 'visible' };
  const stars = Number(req.query.rating);
  if (stars >= 1 && stars <= 5) filter.rating = stars;
  const page = pageParams(req.query);
  const [rows, total, summary] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit).populate('user', 'name photo verification.status status role').lean(),
    Review.countDocuments(filter),
    reviewSummary(tourId)
  ]);
  res.status(200).json({ status: 'success', data: { summary, reviews: rows.filter(r => r.user).map(reviewView), ...paged(total, page) } });
});

exports.tags = (req, res) => {
  res.status(200).json({ status: 'success', data: { tags: Package.TOUR_TAGS.map(t => ({ value: t, label: TAG_LABELS[t] })) } });
};

// ---------- Hearts ----------

const heartTarget = async (kind, id) => {
  if (!validId(id)) return null;
  if (kind === 'tour') return Package.exists({ _id: id, status: 'published' });
  return Hotel.exists({ _id: id, status: 'published' });
};

exports.save = kind => catchAsync(async (req, res, next) => {
  if (!(await heartTarget(kind, req.params.id))) return next(new AppError(`This ${kind} is not available.`, 404));
  await Wishlist.updateOne({ user: req.user._id, kind, item: req.params.id }, { $setOnInsert: { user: req.user._id, kind, item: req.params.id } }, { upsert: true });
  res.status(200).json({ status: 'success', message: 'Saved to your wishlist.', data: { saved: true } });
});

exports.unsave = kind => catchAsync(async (req, res) => {
  if (validId(req.params.id)) await Wishlist.deleteOne({ user: req.user._id, kind, item: req.params.id });
  res.status(200).json({ status: 'success', data: { saved: false } });
});

// GET /me/wishlist?kind=tour|hotel
exports.wishlist = catchAsync(async (req, res) => {
  const kind = Wishlist.KINDS.includes(req.query.kind) ? req.query.kind : null;
  const rows = await Wishlist.find({ user: req.user._id, ...(kind ? { kind } : {}) }).sort({ createdAt: -1 }).limit(100).lean();
  const ids = k => rows.filter(r => r.kind === k).map(r => r.item);
  const [tours, hotels] = await Promise.all([
    loadTours({ _id: { $in: ids('tour') }, status: { $in: ['published', 'cancelled'] } }, 100),
    Hotel.find({ _id: { $in: ids('hotel') }, status: 'published' }).populate({ path: 'destination', select: 'name type status ancestors', populate: { path: 'ancestors', select: 'name type' } })
  ]);
  const ctx = await tourContext(tours, req.user);
  const tourById = new Map(tours.map(t => [String(t._id), tourCard(t, ctx)]));
  const hotelById = new Map(hotels.map(h => [String(h._id), hotelCard(h, { saved: new Set(hotels.map(x => String(x._id))) })]));
  // "Points earned" on each card: what booking it once (one person, one night) would earn
  const perTaka = await pointsPerTaka();
  const pointsFor = card => Math.max(0, Math.round(((card.price && card.price.amount) || 0) * perTaka));
  res.status(200).json({
    status: 'success',
    data: {
      items: rows.map(r => {
        const card = r.kind === 'tour' ? tourById.get(String(r.item)) : hotelById.get(String(r.item));
        return card && { kind: r.kind, savedAt: r.createdAt, pointsToEarn: pointsFor(card), [r.kind]: card };
      }).filter(Boolean)
    }
  });
});

// ---------- Recently viewed ----------

const recentlyViewed = async (user, limit = 10) => {
  const rows = await RecentView.find({ user: user._id }).sort({ viewedAt: -1 }).limit(limit).lean();
  const ids = k => rows.filter(r => r.kind === k).map(r => r.item);
  const placePopulate = { path: 'ancestors', select: 'name type' };
  const [tours, places, hotels] = await Promise.all([
    Package.find({ _id: { $in: ids('tour') }, status: { $in: ['published', 'cancelled'] } }).select('title photos destination destinationRef').populate(PLACE_POPULATE).lean(),
    Destination.find({ _id: { $in: ids('destination') }, status: 'published' }).select('name type status ancestors coverImage gallery slug').populate(placePopulate).lean(),
    Hotel.find({ _id: { $in: ids('hotel') }, status: 'published' }).select('name photos address destination').populate({ path: 'destination', select: 'name type status ancestors', populate: placePopulate }).lean()
  ]);
  const map = list => new Map(list.map(x => [String(x._id), x]));
  const all = { tour: map(tours), destination: map(places), hotel: map(hotels) };
  return rows.map(r => {
    const x = all[r.kind].get(String(r.item));
    if (!x) return null;
    if (r.kind === 'tour') {
      const place = placeView(x.destinationRef);
      return { kind: 'tour', _id: x._id, title: x.title, photo: (x.photos || [])[0] || (x.destinationRef && x.destinationRef.coverImage) || '', location: place ? place.label : x.destination, viewedAt: r.viewedAt };
    }
    if (r.kind === 'destination') {
      const place = placeView(x);
      return { kind: 'destination', _id: x._id, title: x.name, slug: x.slug, photo: x.coverImage || ((x.gallery || [])[0] || {}).url || '', location: place.label.split(', ').slice(1).join(', ') || place.label, viewedAt: r.viewedAt };
    }
    const place = placeView(x.destination);
    return { kind: 'hotel', _id: x._id, title: x.name, photo: (x.photos || [])[0] || '', location: place ? place.label : x.address, viewedAt: r.viewedAt };
  }).filter(Boolean);
};

exports.listRecentlyViewed = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: { items: await recentlyViewed(req.user, RECENT_KEEP) } });
});

exports.clearRecentlyViewed = catchAsync(async (req, res) => {
  await RecentView.deleteMany({ user: req.user._id });
  res.status(204).json({ status: 'success', data: null });
});

// POST /tours/recently-viewed { kind: destination, id } — for places opened outside the Tours tab
exports.addRecentlyViewed = catchAsync(async (req, res, next) => {
  const { kind, id } = req.body;
  if (!RecentView.KINDS.includes(kind) || !validId(id)) return next(new AppError('Say what was viewed: kind (tour, destination or hotel) and id.', 400));
  const Model = { tour: Package, destination: Destination, hotel: Hotel }[kind];
  if (!(await Model.exists({ _id: id, status: 'published' }))) return next(new AppError('That is not available.', 404));
  await remember(req.user, kind, id);
  res.status(200).json({ status: 'success', data: { remembered: true } });
});

// ---------- The whole screen in one call ----------


/**
 * GET /tours/home?type=group&lat&lng
 * Everything on the Tours screen: tour types for the picker, banners, "Continue Your Search",
 * "Popular Destinations", "Recently Viewed", "Hotels Near You", "Special Offers",
 * and the unread count for the bell. Sections that need sign-in are empty when signed out.
 */
exports.home = catchAsync(async (req, res) => {
  // The same filters as GET /tours (the filter panel), applied to the tour sections
  const s = readSearch(req.query);
  const type = s.tourType;
  const tours = await loadTours(await mongoFilter(s));
  const ctx = await tourContext(tours, req.user);
  const filtered = hasFilters(s);
  const ranked = filtered ? rank(tours, ctx, s) : null;
  // The app searches through this screen, so remember it for "Continue Your Search" like GET /tours does
  if (req.user && ranked && worthSaving(s) && req.query.remember !== 'false') await rememberSearch(req.user, s, ranked.length);
  const allowed = ranked ? new Set(ranked.map(c => String(c._id))) : null;
  const cards = tours.filter(t => !allowed || allowed.has(String(t._id))).map(t => ({ card: tourCard(t, ctx), score: popularityScore(t, ctx) }));

  // One card per destination for "Popular Destinations": its most popular tour
  const seenPlaces = new Set();
  const popular = cards.slice().sort((a, b) => b.score - a.score).filter(({ card }) => {
    const key = card.place ? String(card.place._id) : card.location;
    if (seenPlaces.has(key)) return false;
    seenPlaces.add(key);
    return true;
  }).slice(0, 10).map(c => c.card);
  const offers = cards.filter(c => c.card.price.discountPercent > 0)
    .sort((a, b) => b.card.price.discountPercent - a.card.price.discountPercent || b.score - a.score).slice(0, 10).map(c => c.card);

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const [banners, searches, recent, hotels, types, unread] = await Promise.all([
    liveBanners(req, { count: true }),
    req.user ? recentSearches(req.user, 5) : [],
    req.user ? recentlyViewed(req.user, 10) : [],
    nearbyHotels({ lat, lng, user: req.user, limit: 10 }),
    typeCounts(),
    req.user ? Notification.countDocuments({ user: req.user._id, readAt: null, ...Notification.NOT_CHAT }) : 0
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      types,
      selectedType: type || 'all',
      // When the filter panel is used: what's applied, how many tours match, and the first of them
      filters: filtered ? {
        q: s.query || null,
        destination: s.destination || null,
        themes: s.tags,
        date: s.date ? s.date.toISOString().slice(0, 10) : null,
        minPrice: s.minPrice,
        maxPrice: s.maxPrice
      } : null,
      resultCount: ranked ? ranked.length : null,
      results: ranked ? ranked.slice(0, 20) : null,
      unreadNotifications: unread,
      banners: banners.banners.map(bannerView),
      // How many agents' ads are live; the app can offer a "See all" screen (GET /promotions/ads)
      adsTotal: banners.adsTotal,
      continueSearch: searches,
      popularDestinations: popular,
      recentlyViewed: recent,
      hotelsNearYou: hotels.hotels,
      hotelsNearYouBasis: hotels.basis,
      specialOffers: offers
    }
  });
});

exports.TYPE_LABELS = TYPE_LABELS;
exports.savedSet = savedSet;
