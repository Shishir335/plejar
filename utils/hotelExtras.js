const Review = require('../models/reviewModel');
const Agency = require('../models/agencyModel');
const AppError = require('./appError');
const { userCard } = require('./social');

// What a hotel page shows beyond the basics: breakfast and dining, places nearby, the distance from
// the centre, whether the hotel is verified, and its guests' reviews. The admin form and the hotel
// panel both edit these through applyHotelExtras.

const BREAKFAST = ['', 'included', 'extra'];
const MEALS = ['lunch', 'dinner', 'snacks', 'room_service'];
const NEARBY_KINDS = ['restaurant', 'cafe', 'grocery', 'attraction', 'transport'];
const MAX_NEARBY = 30;

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const has = (b, key) => Object.prototype.hasOwnProperty.call(b, key);

// A form sends objects as JSON text; JSON bodies send them as they are
const parsed = (value, label) => {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    throw new AppError(`Could not read the ${label}. Refresh the page and try again.`, 400);
  }
};

const textList = (v, max, len) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map(s => text(s, len)).filter(Boolean))].slice(0, max);

/** Apply `dining`, `nearby` and `centreDistanceKm` from a form or JSON body. Throws AppError on bad input. */
const applyHotelExtras = (hotel, b) => {
  if (!b) return;
  if (has(b, 'dining')) {
    const d = parsed(b.dining, 'dining details') || {};
    if (has(d, 'breakfast')) {
      if (!BREAKFAST.includes(d.breakfast || '')) throw new AppError('Choose whether breakfast is included, extra or not served.', 400);
      hotel.set('dining.breakfast', d.breakfast || '');
    }
    // One of the hotel's own photos; dropped on save if that photo is removed
    if (has(d, 'breakfastPhoto')) hotel.set('dining.breakfastPhoto', text(d.breakfastPhoto, 500));
    if (has(d, 'meals')) hotel.set('dining.meals', textList(d.meals, MEALS.length, 20).filter(m => MEALS.includes(m)));
    if (has(d, 'facilities')) hotel.set('dining.facilities', textList(d.facilities, 12, 40));
  }
  if (has(b, 'nearby')) {
    const rows = parsed(b.nearby, 'places nearby') || [];
    if (!Array.isArray(rows)) throw new AppError('Could not read the places nearby.', 400);
    if (rows.length > MAX_NEARBY) throw new AppError(`Add up to ${MAX_NEARBY} places nearby.`, 400);
    hotel.nearby = rows.map(r => {
      const name = text(r && r.name, 80);
      if (!name) throw new AppError('Give each place nearby a name.', 400);
      if (!NEARBY_KINDS.includes(r.category)) throw new AppError(`Choose what ${name} is.`, 400);
      const raw = String(r.distance == null ? '' : r.distance).replace(/[,\s]/g, '');
      const distance = raw === '' ? null : Number(raw);
      if (distance !== null && (!Number.isInteger(distance) || distance < 0 || distance > 100000)) {
        throw new AppError(`Enter how far ${name} is in metres, as a whole number up to 100000.`, 400);
      }
      return { category: r.category, name, distance };
    });
  }
  if (has(b, 'centreDistanceKm')) {
    const raw = String(b.centreDistanceKm == null ? '' : b.centreDistanceKm).trim();
    const km = raw === '' ? null : Number(raw);
    if (km !== null && (!Number.isFinite(km) || km < 0 || km > 1000)) throw new AppError('Enter the distance from the centre in km, from 0 to 1000.', 400);
    hotel.centreDistanceKm = km === null ? null : Math.round(km * 10) / 10;
  }
};

const extrasView = h => {
  const d = h.dining || {};
  return {
    dining: {
      breakfast: d.breakfast || '',
      breakfastPhoto: d.breakfastPhoto || '',
      meals: d.meals || [],
      facilities: d.facilities || []
    },
    nearby: (h.nearby || []).map(n => ({ category: n.category, name: n.name, distance: n.distance })),
    centreDistanceKm: h.centreDistanceKm == null ? null : h.centreDistanceKm
  };
};

// A hotel with its own account is verified once Plejar verified that account
const isVerified = async hotel => Boolean(hotel.agency && (await Agency.exists({ _id: hotel.agency, verified: true })));

const reviewView = r => ({
  _id: r._id,
  rating: r.rating,
  comment: r.comment,
  createdAt: r.createdAt,
  stayedAt: r.booking && r.booking.travelDate ? r.booking.travelDate : null,
  author: userCard(r.user)
});

/** Average, count and how many of each star, for a hotel's visible reviews */
const hotelReviewSummary = async hotelId => {
  const rows = await Review.aggregate([
    { $match: { hotel: hotelId, status: 'visible' } },
    { $group: { _id: '$rating', count: { $sum: 1 } } }
  ]);
  const count = rows.reduce((n, r) => n + r.count, 0);
  const total = rows.reduce((n, r) => n + r._id * r.count, 0);
  const breakdown = Object.fromEntries([5, 4, 3, 2, 1].map(star => [star, (rows.find(r => r._id === star) || { count: 0 }).count]));
  return { average: count ? Math.round((total / count) * 10) / 10 : null, count, breakdown };
};

/** Newest visible reviews first */
const hotelReviewRows = (hotelId, { skip = 0, limit = 3, rating } = {}) => {
  const filter = { hotel: hotelId, status: 'visible' };
  if (rating) filter.rating = rating;
  return Review.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('user', 'name photo verification.status status role')
    .populate('booking', 'travelDate')
    .lean()
    .then(rows => rows.filter(r => r.user).map(reviewView));
};

module.exports = {
  BREAKFAST,
  MEALS,
  NEARBY_KINDS,
  applyHotelExtras,
  extrasView,
  isVerified,
  hotelReviewSummary,
  hotelReviewRows
};
