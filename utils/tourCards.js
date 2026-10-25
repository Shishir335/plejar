const Review = require('../models/reviewModel');
const Booking = require('../models/bookingModel');
const Wishlist = require('../models/wishlistModel');
const { registrationStats, withStats } = require('./events');

// Cards for the app's Tours screen: tours, hotels and places, in one shape the app can rely on

const AGENCY_CARD = 'name logo verified status';

// A tour's destination with its parents, for "Tanguar Haor, Kishoreganj, Bangladesh"
const PLACE_POPULATE = {
  path: 'destinationRef',
  select: 'name type status ancestors coverImage',
  populate: { path: 'ancestors', select: 'name type' }
};

const placeView = dest => {
  if (!dest || !dest.name || (dest.status && dest.status !== 'published')) return null;
  const ancestors = (dest.ancestors || []).filter(a => a && a.name);
  // The place itself, the area it is in, and the country
  const parts = [dest.name, ancestors.length > 1 ? ancestors[ancestors.length - 1].name : null, ancestors.length ? ancestors[0].name : null];
  const label = parts.filter((p, i) => p && parts.indexOf(p) === i).join(', ');
  return { _id: dest._id, name: dest.name, type: dest.type, label };
};

const priceView = (current, regular) => {
  const sale = regular != null && current != null && regular > current;
  return {
    currency: 'BDT',
    amount: current,
    regular: sale ? regular : null,
    discountPercent: sale ? Math.round(((regular - current) / regular) * 100) : 0
  };
};

/** Average visible review rating per tour: Map(tourId -> { average, count }) */
const tourRatings = async tourIds => {
  if (!tourIds.length) return new Map();
  const rows = await Review.aggregate([
    { $match: { package: { $in: tourIds }, status: 'visible' } },
    { $group: { _id: '$package', average: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);
  return new Map(rows.map(r => [String(r._id), { average: Math.round(r.average * 10) / 10, count: r.count }]));
};

/** Registrations that weren't cancelled, per tour, for "popular" */
const tourBookingCounts = async tourIds => {
  if (!tourIds.length) return new Map();
  const rows = await Booking.aggregate([
    { $match: { package: { $in: tourIds }, status: { $ne: 'cancelled' } } },
    { $group: { _id: '$package', count: { $sum: 1 } } }
  ]);
  return new Map(rows.map(r => [String(r._id), r.count]));
};

/** Which of these items the traveler hearted */
const savedSet = async (user, kind, ids) => {
  if (!user || !ids.length) return new Set();
  const rows = await Wishlist.find({ user: user._id, kind, item: { $in: ids } }).select('item').lean();
  return new Set(rows.map(r => String(r.item)));
};

/**
 * Everything the cards need for a list of tours, loaded in a few queries:
 * seats left, ratings, booking counts and the viewer's hearts.
 */
const tourContext = async (tours, user) => {
  const ids = tours.map(t => t._id);
  const [stats, ratings, bookings, saved] = await Promise.all([
    registrationStats(ids),
    tourRatings(ids),
    tourBookingCounts(ids),
    savedSet(user, 'tour', ids)
  ]);
  return { stats, ratings, bookings, saved };
};

const popularityScore = (tour, ctx) => {
  const rating = ctx.ratings.get(String(tour._id));
  return (ctx.bookings.get(String(tour._id)) || 0) * 5 + (tour.viewCount || 0) + (rating ? rating.average * rating.count * 2 : 0);
};

const snippet = (text, n = 110) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const tourCard = (tour, ctx) => {
  const t = withStats(tour, ctx.stats);
  const id = String(tour._id);
  const place = placeView(tour.destinationRef);
  return {
    _id: tour._id,
    title: tour.title,
    summary: snippet(tour.description),
    photo: (tour.photos || [])[0] || (tour.destinationRef && tour.destinationRef.coverImage) || '',
    photos: tour.photos || [],
    tourType: tour.tourType || 'group',
    place,
    location: place ? place.label : tour.destination,
    highlights: tour.highlights || [],
    rating: ctx.ratings.get(id) || { average: null, count: 0 },
    price: priceView(tour.priceFrom, tour.regularPrice),
    durationDays: tour.durationDays,
    durationNights: tour.durationNights,
    groupSize: tour.groupSize && (tour.groupSize.min || tour.groupSize.max) ? { min: tour.groupSize.min, max: tour.groupSize.max } : null,
    flexibleDates: Boolean(tour.flexibleDates),
    startDate: tour.startDate,
    endDate: tour.endDate,
    seatsLeft: t.seatsLeft,
    difficulty: tour.difficulty || null,
    agency: tour.agency && tour.agency.name ? { _id: tour.agency._id, name: tour.agency.name, logo: tour.agency.logo || '', verified: Boolean(tour.agency.verified) } : null,
    viewer: { saved: ctx.saved.has(id) }
  };
};

const hotelCard = (hotel, { saved = new Set(), distanceKm } = {}) => {
  const place = placeView(hotel.destination);
  return {
    _id: hotel._id,
    name: hotel.name,
    type: hotel.type,
    summary: snippet(hotel.description),
    photo: (hotel.photos || [])[0] || '',
    photos: hotel.photos || [],
    place,
    location: place ? place.label : hotel.address,
    address: hotel.address,
    coordinates: hotel.location && hotel.location.coordinates && hotel.location.coordinates.length === 2
      ? { lat: hotel.location.coordinates[1], lng: hotel.location.coordinates[0] } : null,
    distanceKm: distanceKm == null ? null : Math.round(distanceKm * 10) / 10,
    highlights: hotel.highlights || [],
    starRating: hotel.starRating || null,
    rating: hotel.rating && hotel.rating.average != null ? { average: hotel.rating.average, count: hotel.rating.count || 0, source: hotel.rating.source || '' } : { average: null, count: 0, source: '' },
    price: { ...priceView(hotel.pricePerNight, hotel.regularPrice), per: 'night' },
    viewer: { saved: saved.has(String(hotel._id)) }
  };
};

module.exports = {
  AGENCY_CARD,
  PLACE_POPULATE,
  placeView,
  priceView,
  tourRatings,
  tourContext,
  popularityScore,
  savedSet,
  tourCard,
  hotelCard
};
