const Destination = require('../models/destinationModel');
const Package = require('../models/packageModel');
const Booking = require('../models/bookingModel');
const AppError = require('./appError');

const DAY = 24 * 60 * 60 * 1000;
const TRENDING_DAYS = 30;

// "Cox's Bazar Sea Beach" -> "coxs-bazar-sea-beach"
const slugify = value => String(value || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120);

// A slug no other destination uses: sajek-valley, sajek-valley-2, ...
const uniqueSlug = async (wanted, exceptId) => {
  const base = slugify(wanted) || 'place';
  for (let n = 1; n < 500; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    // eslint-disable-next-line no-await-in-loop
    const taken = await Destination.exists({ slug, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
    if (!taken) return slug;
  }
  throw new AppError('Could not find a free web address for this place. Choose a different one.', 400);
};

/**
 * Check a parent for a destination of `type` and return the new ancestors path.
 * Refuses a parent of the wrong type, or one that sits inside the destination itself.
 */
const placeUnder = async (type, parentId, selfId) => {
  const allowed = Destination.PARENT_TYPES[type];
  if (!parentId) {
    if (type !== 'country') throw new AppError(`Choose where this ${type} is (its ${allowed.join(' or ')}).`, 400);
    return { parent: null, ancestors: [] };
  }
  if (type === 'country') throw new AppError('A country cannot sit inside another place.', 400);
  const parent = await Destination.findById(parentId).select('type ancestors name');
  if (!parent) throw new AppError('The place you chose to put this under no longer exists.', 400);
  if (!allowed.includes(parent.type)) {
    throw new AppError(`A ${type} can only sit under a ${allowed.join(' or ')}, not a ${parent.type}.`, 400);
  }
  if (selfId && (String(parent._id) === String(selfId) || parent.ancestors.some(a => String(a) === String(selfId)))) {
    throw new AppError('A place cannot sit inside itself or one of its own places.', 400);
  }
  return { parent: parent._id, ancestors: [...parent.ancestors, parent._id] };
};

// After moving a destination, every place inside it gets the new path too
const refreshDescendants = async node => {
  const children = await Destination.find({ parent: node._id }).select('ancestors');
  await Promise.all(children.map(async child => {
    child.ancestors = [...node.ancestors, node._id];
    await child.save({ validateBeforeSave: false });
    await refreshDescendants(child);
  }));
};

const EMPTY = () => ({ events: 0, upcomingEvents: 0, bookings: 0, travelers: 0, revenue: 0, recentBookings: 0, recentTravelers: 0 });

/**
 * Numbers for every destination, each including the places inside it:
 * tour events linked to it, upcoming events, registrations, travelers, paid revenue,
 * and registrations in the last 30 days (which drives "trending").
 */
const rollupStats = async () => {
  const now = new Date();
  const since = new Date(Date.now() - TRENDING_DAYS * DAY);
  const [nodes, eventRows, bookingRows] = await Promise.all([
    Destination.find().select('_id ancestors').lean(),
    Package.aggregate([
      { $match: { destinationRef: { $ne: null } } },
      {
        $group: {
          _id: '$destinationRef',
          events: { $sum: { $cond: [{ $ne: ['$status', 'draft'] }, 1, 0] } },
          upcomingEvents: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'published'] }, { $gte: ['$startDate', now] }] }, 1, 0] } }
        }
      }
    ]),
    Booking.aggregate([
      { $match: { destinationRef: { $ne: null }, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$destinationRef',
          bookings: { $sum: 1 },
          travelers: { $sum: '$travelers' },
          revenue: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$amount', 0] } },
          recentBookings: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } },
          recentTravelers: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, '$travelers', 0] } }
        }
      }
    ])
  ]);

  const own = new Map();
  const add = (id, row) => {
    const key = String(id);
    const s = own.get(key) || EMPTY();
    Object.keys(s).forEach(k => { if (row[k]) s[k] += row[k]; });
    own.set(key, s);
  };
  eventRows.forEach(r => add(r._id, r));
  bookingRows.forEach(r => add(r._id, r));

  // Each place's own numbers count towards itself and every place above it
  const total = new Map(nodes.map(n => [String(n._id), EMPTY()]));
  nodes.forEach(n => {
    const s = own.get(String(n._id));
    if (!s) return;
    [n._id, ...(n.ancestors || [])].forEach(id => {
      const t = total.get(String(id));
      if (t) Object.keys(t).forEach(k => { t[k] += s[k]; });
    });
  });
  return total;
};

const statsOf = (stats, id) => (stats && stats.get(String(id))) || EMPTY();

// Higher means more travelers are booking it lately; pinned places always come first
const trendingScore = (dest, s) => (dest.trendingPinned ? 1e9 : 0) + s.recentTravelers * 3 + s.recentBookings + s.upcomingEvents * 2;
const popularityScore = (dest, s) => s.travelers * 2 + s.events * 3 + Math.round((dest.views || 0) / 20);

// The names above a destination, e.g. "Bangladesh › Chattogram › Rangamati"
const pathNames = async destinations => {
  const ids = [...new Set(destinations.flatMap(d => (d.ancestors || []).map(String)))];
  const names = new Map((await Destination.find({ _id: { $in: ids } }).select('name').lean()).map(d => [String(d._id), d.name]));
  return d => (d.ancestors || []).map(a => names.get(String(a))).filter(Boolean);
};

// Valid month numbers 1-12, unique and sorted
const toMonths = value => {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map(Number).filter(m => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b);
};

// Latitude/longitude from the request, or null to clear. Throws on bad input.
const toLocation = (lat, lng) => {
  if ((lat === '' || lat === null || lat === undefined) && (lng === '' || lng === null || lng === undefined)) return null;
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || la < -90 || la > 90) throw new AppError('Latitude must be a number between -90 and 90.', 400);
  if (!Number.isFinite(lo) || lo < -180 || lo > 180) throw new AppError('Longitude must be a number between -180 and 180.', 400);
  return { type: 'Point', coordinates: [Math.round(lo * 1e6) / 1e6, Math.round(la * 1e6) / 1e6] };
};

module.exports = {
  TRENDING_DAYS,
  slugify,
  uniqueSlug,
  placeUnder,
  refreshDescendants,
  rollupStats,
  statsOf,
  trendingScore,
  popularityScore,
  pathNames,
  toMonths,
  toLocation
};
