const mongoose = require('mongoose');
const { cancelRefundView } = require('../utils/cancelRefund');
const paymentConfig = require('../utils/payments/config');
const Hotel = require('../models/hotelModel');
const Destination = require('../models/destinationModel');
const RecentView = require('../models/recentViewModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { escapeRegex, pageParams, paged } = require('../utils/query');
const { logActivity } = require('../utils/activity');
const { saveContentImage, removeContentImage, removeContentFolder } = require('../utils/uploads');
const { placeView, priceView, hotelCard, savedSet } = require('../utils/tourCards');
const { applyHotelExtras, extrasView, isVerified, hotelReviewSummary, hotelReviewRows } = require('../utils/hotelExtras');

// Hotels for the app ("Hotels Near You" on the Tours screen) and their management in the admin panel

const validId = id => mongoose.isValidObjectId(id);
const NEARBY_KM = 100;
const PLACE = { path: 'destination', select: 'name type status ancestors coverImage', populate: { path: 'ancestors', select: 'name type' } };

const subtree = async id => [new mongoose.Types.ObjectId(String(id)), ...(await Destination.find({ ancestors: id }).select('_id').lean()).map(d => d._id)];

/**
 * Hotels near a point (nearest first, within 100 km), or featured hotels when the app
 * didn't send a location. Returns { hotels: [cards], basis: 'location' | 'featured' }.
 */
const nearbyHotels = async ({ lat, lng, user, limit = 10, radiusKm = NEARBY_KM }) => {
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  let rows;
  let distances = new Map();
  if (hasPoint) {
    const near = await Hotel.aggregate([
      { $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'distance', maxDistance: radiusKm * 1000, query: { status: 'published' }, spherical: true } },
      { $limit: limit },
      { $project: { _id: 1, distance: 1 } }
    ]);
    distances = new Map(near.map(n => [String(n._id), n.distance / 1000]));
    const docs = await Hotel.find({ _id: { $in: near.map(n => n._id) } }).populate(PLACE);
    rows = docs.sort((a, b) => distances.get(String(a._id)) - distances.get(String(b._id)));
  }
  const basis = hasPoint && rows.length ? 'location' : 'featured';
  if (basis === 'featured') rows = await Hotel.find({ status: 'published' }).sort({ featured: -1, 'rating.average': -1, viewCount: -1, name: 1 }).limit(limit).populate(PLACE);
  const saved = await savedSet(user, 'hotel', rows.map(h => h._id));
  return { basis, hotels: rows.map(h => hotelCard(h, { saved, distanceKm: distances.get(String(h._id)) })) };
};
exports.nearbyHotels = nearbyHotels;

// ---------- App ----------

// GET /hotels/nearby?lat&lng&radiusKm&limit
exports.nearby = catchAsync(async (req, res) => {
  const radius = Math.min(Math.max(Number(req.query.radiusKm) || NEARBY_KM, 1), 500);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const result = await nearbyHotels({ lat: Number(req.query.lat), lng: Number(req.query.lng), user: req.user, limit, radiusKm: radius });
  res.status(200).json({ status: 'success', data: result });
});

// GET /hotels?q&destination&type&minPrice&maxPrice&sort=popular|price_asc|price_desc|rating|name&page
exports.listHotels = catchAsync(async (req, res, next) => {
  const q = req.query;
  const filter = { status: 'published' };
  if (q.destination) {
    if (!validId(q.destination)) return next(new AppError('Unknown destination.', 400));
    filter.destination = { $in: await subtree(q.destination) };
  }
  if (q.type && Hotel.STAY_TYPES.includes(q.type)) filter.type = q.type;
  if (q.q) {
    const rx = { $regex: escapeRegex(String(q.q).trim()), $options: 'i' };
    filter.$or = [{ name: rx }, { address: rx }, { highlights: rx }];
  }
  if (q.minPrice || q.maxPrice) {
    filter.pricePerNight = {};
    if (q.minPrice) filter.pricePerNight.$gte = Number(q.minPrice);
    if (q.maxPrice) filter.pricePerNight.$lte = Number(q.maxPrice);
  }
  const sort = {
    price_asc: { pricePerNight: 1 },
    price_desc: { pricePerNight: -1 },
    rating: { 'rating.average': -1, 'rating.count': -1 },
    name: { name: 1 }
  }[q.sort] || { featured: -1, viewCount: -1, name: 1 };
  const page = pageParams(q);
  const [rows, total] = await Promise.all([
    Hotel.find(filter).sort(sort).skip(page.skip).limit(page.limit).populate(PLACE),
    Hotel.countDocuments(filter)
  ]);
  const saved = await savedSet(req.user, 'hotel', rows.map(h => h._id));
  res.status(200).json({ status: 'success', data: { hotels: rows.map(h => hotelCard(h, { saved })), ...paged(total, page) } });
});

// GET /hotels/:id — the full hotel page
exports.getHotel = catchAsync(async (req, res, next) => {
  const hotel = validId(req.params.id) ? await Hotel.findOne({ _id: req.params.id, status: 'published' }).populate(PLACE) : null;
  if (!hotel) return next(new AppError('This hotel is not available.', 404));
  const [saved, verified, summary, latest] = await Promise.all([
    savedSet(req.user, 'hotel', [hotel._id]),
    isVerified(hotel),
    hotelReviewSummary(hotel._id),
    hotelReviewRows(hotel._id, { limit: 3 })
  ]);
  await Hotel.updateOne({ _id: hotel._id }, { $inc: { viewCount: 1 } });
  if (req.user) await RecentView.updateOne({ user: req.user._id, kind: 'hotel', item: hotel._id }, { $set: { viewedAt: new Date() } }, { upsert: true });
  res.status(200).json({
    status: 'success',
    data: {
      hotel: {
        ...hotelCard(hotel, { saved }),
        description: hotel.description,
        amenities: hotel.amenities,
        phone: hotel.phone,
        website: hotel.website,
        checkIn: hotel.checkIn,
        checkOut: hotel.checkOut,
        // Paid online per room when asking for a stay: send payWith (one of paymentMethods) with the request
        bookingMoney: hotel.agency && hotel.bookingMoney >= 1 ? { perRoom: Math.round(hotel.bookingMoney), cancelRefund: cancelRefundView(hotel) } : null,
        paymentMethods: paymentConfig.enabledMethods(),
        // Room types and house rules the hotel manages itself; stays can be requested when it has its own account
        roomTypes: (hotel.roomTypes || []).filter(r => r.active !== false).map(r => ({
          _id: r._id,
          name: r.name,
          description: r.description,
          price: { ...priceView(r.pricePerNight, r.regularPrice), per: 'night' },
          maxGuests: r.maxGuests,
          beds: r.beds,
          sizeSqft: r.sizeSqft,
          rooms: r.count,
          amenities: r.amenities,
          benefits: r.benefits || [],
          photos: r.photos
        })),
        policies: hotel.policies || {},
        verified,
        ...extrasView(hotel),
        // Reviews from guests who booked through Plejar
        reviews: { ...summary, latest },
        canRequestStay: Boolean(hotel.agency) && (hotel.roomTypes || []).some(r => r.active !== false)
      }
    }
  });
});

// GET /hotels/:id/reviews?page&rating — every guest review, newest first
exports.hotelReviews = catchAsync(async (req, res, next) => {
  const hotel = validId(req.params.id) ? await Hotel.findOne({ _id: req.params.id, status: 'published' }).select('_id') : null;
  if (!hotel) return next(new AppError('This hotel is not available.', 404));
  const stars = Number(req.query.rating);
  const rating = stars >= 1 && stars <= 5 ? stars : undefined;
  const page = pageParams(req.query);
  const [reviews, summary] = await Promise.all([
    hotelReviewRows(hotel._id, { skip: page.skip, limit: page.limit, rating }),
    hotelReviewSummary(hotel._id)
  ]);
  const total = rating ? summary.breakdown[rating] : summary.count;
  res.status(200).json({ status: 'success', data: { summary, reviews, ...paged(total, page) } });
});

// ---------- Admin ----------

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const list = (v, max, len = 60) => (Array.isArray(v) ? v : String(v || '').split('\n')).map(s => text(s, len)).filter(Boolean).slice(0, max);
const money = (v, label, { required = false } = {}) => {
  if (v === '' || v === null || v === undefined) {
    if (required) throw new AppError(`Enter the ${label}.`, 400);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError(`Enter the ${label} in taka, 0 or more.`, 400);
  return Math.round(n);
};

/** Apply an admin form (JSON or multipart) to a hotel. Throws AppError on bad input. */
const applyHotelForm = async (hotel, b) => {
  if (b.name !== undefined) hotel.name = text(b.name, 120);
  if (b.type !== undefined) {
    if (!Hotel.STAY_TYPES.includes(b.type)) throw new AppError(`Choose the kind of stay: ${Hotel.STAY_TYPES.join(', ')}.`, 400);
    hotel.type = b.type;
  }
  if (b.description !== undefined) hotel.description = text(b.description, 3000);
  if (b.address !== undefined) hotel.address = text(b.address, 200);
  if (b.destination !== undefined) {
    if (!b.destination) hotel.destination = undefined;
    else {
      if (!validId(b.destination) || !(await Destination.exists({ _id: b.destination }))) throw new AppError('Choose a destination from the list.', 400);
      hotel.destination = b.destination;
    }
  }
  if (b.lat !== undefined || b.lng !== undefined) {
    const lat = b.lat === '' ? null : Number(b.lat);
    const lng = b.lng === '' ? null : Number(b.lng);
    if (lat === null && lng === null) hotel.location = undefined;
    else {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new AppError('Enter a valid latitude and longitude, for example 21.4272 and 92.0058.', 400);
      hotel.location = { type: 'Point', coordinates: [lng, lat] };
    }
  }
  if (b.pricePerNight !== undefined) hotel.pricePerNight = money(b.pricePerNight, 'price per night', { required: true });
  if (b.regularPrice !== undefined) hotel.regularPrice = money(b.regularPrice, 'regular price');
  if (hotel.regularPrice != null && hotel.pricePerNight != null && hotel.regularPrice < hotel.pricePerNight) throw new AppError('The regular price cannot be lower than the price per night.', 400);
  if (b.highlights !== undefined) hotel.highlights = list(b.highlights, 6);
  if (b.amenities !== undefined) hotel.amenities = list(b.amenities, 40);
  if (b.starRating !== undefined) {
    const n = b.starRating === '' || b.starRating === null ? null : Number(b.starRating);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 5)) throw new AppError('Star rating is 1 to 5.', 400);
    hotel.starRating = n;
  }
  if (b.ratingAverage !== undefined || b.ratingCount !== undefined || b.ratingSource !== undefined) {
    const avg = b.ratingAverage === '' || b.ratingAverage == null ? null : Number(b.ratingAverage);
    if (avg !== null && (!Number.isFinite(avg) || avg < 0 || avg > 5)) throw new AppError('Guest rating is 0 to 5.', 400);
    hotel.rating = { average: avg, count: Math.max(0, Math.round(Number(b.ratingCount) || 0)), source: text(b.ratingSource, 40) };
  }
  if (b.phone !== undefined) hotel.phone = text(b.phone, 30);
  if (b.website !== undefined) hotel.website = text(b.website, 200);
  if (b.checkIn !== undefined) hotel.checkIn = text(b.checkIn, 10);
  if (b.checkOut !== undefined) hotel.checkOut = text(b.checkOut, 10);
  applyHotelExtras(hotel, b);
  if (b.featured !== undefined) hotel.featured = b.featured === true || b.featured === 'true';
  if (b.status !== undefined) {
    if (!['draft', 'published', 'hidden'].includes(b.status)) throw new AppError('Choose draft, published or hidden.', 400);
    hotel.status = b.status;
  }
  if (hotel.status === 'published') {
    const missing = [];
    if (!hotel.name) missing.push('the name');
    if (hotel.pricePerNight == null) missing.push('the price per night');
    if (!hotel.destination && !(hotel.location && hotel.location.coordinates)) missing.push('where it is (a destination or the map position)');
    if (missing.length) throw new AppError(`To publish, add ${missing.join(', ')}.`, 400);
  }
};

const adminHotelView = h => ({
  ...hotelCard(h),
  status: h.status,
  featured: h.featured,
  description: h.description,
  amenities: h.amenities,
  starRating: h.starRating,
  phone: h.phone,
  website: h.website,
  checkIn: h.checkIn,
  checkOut: h.checkOut,
  destinationId: h.destination ? h.destination._id || h.destination : null,
  regularPrice: h.regularPrice,
  pricePerNight: h.pricePerNight,
  ...extrasView(h),
  viewCount: h.viewCount,
  updatedAt: h.updatedAt
});

exports.adminList = catchAsync(async (req, res) => {
  const q = req.query;
  const filter = {};
  if (['draft', 'published', 'hidden'].includes(q.status)) filter.status = q.status;
  if (q.search) filter.name = { $regex: escapeRegex(String(q.search).trim()), $options: 'i' };
  if (validId(q.destination)) filter.destination = { $in: await subtree(q.destination) };
  const page = pageParams(q);
  const [rows, total, counts] = await Promise.all([
    Hotel.find(filter).sort({ updatedAt: -1 }).skip(page.skip).limit(page.limit).populate(PLACE),
    Hotel.countDocuments(filter),
    Hotel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  ]);
  res.status(200).json({
    status: 'success',
    data: { hotels: rows.map(adminHotelView), counts: Object.fromEntries(counts.map(c => [c._id, c.count])), types: Hotel.STAY_TYPES, ...paged(total, page) }
  });
});

exports.adminGet = catchAsync(async (req, res, next) => {
  const hotel = validId(req.params.id) ? await Hotel.findById(req.params.id).populate(PLACE) : null;
  if (!hotel) return next(new AppError('No hotel found with that ID.', 404));
  res.status(200).json({ status: 'success', data: { hotel: adminHotelView(hotel) } });
});

const addPhotos = async (hotel, files) => {
  const room = 12 - hotel.photos.length;
  if (files.length > room) throw new AppError(`A hotel can have up to 12 photos (${room} more).`, 400);
  const urls = await Promise.all(files.map(f => saveContentImage(f, 'hotels', hotel._id)));
  hotel.photos.push(...urls);
};

exports.adminCreate = catchAsync(async (req, res) => {
  const hotel = new Hotel({ createdBy: req.user._id, status: 'draft' });
  await applyHotelForm(hotel, req.body);
  await hotel.validate();
  if (req.files && req.files.length) await addPhotos(hotel, req.files);
  await hotel.save();
  await hotel.populate(PLACE);
  await logActivity(req, { action: 'hotel.created', summary: `Hotel added: ${hotel.name}` });
  res.status(201).json({ status: 'success', data: { hotel: adminHotelView(hotel) } });
});

exports.adminUpdate = catchAsync(async (req, res, next) => {
  const hotel = validId(req.params.id) ? await Hotel.findById(req.params.id) : null;
  if (!hotel) return next(new AppError('No hotel found with that ID.', 404));
  await applyHotelForm(hotel, req.body);
  if (req.files && req.files.length) await addPhotos(hotel, req.files);
  // removePhotos: photo URLs to drop; photoOrder: the photos in the order to show
  const remove = [].concat(req.body.removePhotos || []).flatMap(v => String(v).split(',')).map(s => s.trim()).filter(Boolean);
  if (remove.length) {
    await Promise.all(hotel.photos.filter(p => remove.includes(p)).map(removeContentImage));
    hotel.photos = hotel.photos.filter(p => !remove.includes(p));
  }
  if (req.body.photoOrder) {
    const order = [].concat(req.body.photoOrder).flatMap(v => String(v).split(',')).map(s => s.trim());
    hotel.photos = [...order.filter(p => hotel.photos.includes(p)), ...hotel.photos.filter(p => !order.includes(p))];
  }
  await hotel.save();
  await hotel.populate(PLACE);
  await logActivity(req, { action: 'hotel.updated', summary: `Hotel updated: ${hotel.name}` });
  res.status(200).json({ status: 'success', data: { hotel: adminHotelView(hotel) } });
});

exports.adminDelete = catchAsync(async (req, res, next) => {
  const hotel = validId(req.params.id) ? await Hotel.findById(req.params.id) : null;
  if (!hotel) return next(new AppError('No hotel found with that ID.', 404));
  await removeContentFolder('hotels', hotel._id);
  await hotel.deleteOne();
  await logActivity(req, { action: 'hotel.deleted', summary: `Hotel deleted: ${hotel.name}` });
  res.status(204).json({ status: 'success', data: null });
});

exports.placeView = placeView;
