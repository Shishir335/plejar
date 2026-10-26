const mongoose = require('mongoose');
const Guide = require('../models/guideModel');
const Package = require('../models/packageModel');
const Destination = require('../models/destinationModel');
const Review = require('../models/reviewModel');
const Booking = require('../models/bookingModel');
const { escapeRegex, pageParams, paged } = require('../utils/query');
const { placeView, priceView } = require('../utils/tourCards');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { saveAgencyImage, removeAgencyImage } = require('../utils/uploads');

// An agency's tour guides, managed in the vendor panel and shown on the app's tour page

const validId = id => mongoose.isValidObjectId(id);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/** The guide as the app shows it ("Your Tour Guide"); never includes the phone number */
const publicGuide = g => (g && g.name ? {
  _id: g._id,
  name: g.name,
  photo: g.photo || '',
  location: g.location || '',
  languages: g.languages || [],
  experienceYears: g.experienceYears,
  bio: g.bio || ''
} : null);
exports.publicGuide = publicGuide;

const money = (v, label) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError(`Enter the ${label} in taka, 0 or more.`, 400);
  return Math.round(n);
};

const applyForm = async (guide, b) => {
  if (b.name !== undefined) guide.name = text(b.name, 80);
  if (b.location !== undefined) guide.location = text(b.location, 120);
  if (b.languages !== undefined) {
    const list = Array.isArray(b.languages) ? b.languages : String(b.languages || '').split(/[,\n]/);
    guide.languages = [...new Set(list.map(l => text(l, 30)).filter(Boolean))].slice(0, 10);
  }
  if (b.experienceYears !== undefined) {
    const n = b.experienceYears === '' || b.experienceYears === null ? null : Number(b.experienceYears);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 70)) throw new AppError('Enter the years of experience as a whole number.', 400);
    guide.experienceYears = n;
  }
  if (b.bio !== undefined) guide.bio = text(b.bio, 1500);
  if (b.phone !== undefined) guide.phone = text(b.phone, 30);
  if (b.active !== undefined) guide.active = b.active === true || b.active === 'true';

  // Hiring the guide on their own from the app
  if (b.title !== undefined) guide.title = text(b.title, 60);
  if (b.pricePerDay !== undefined) guide.pricePerDay = money(b.pricePerDay, 'price per day');
  if (b.regularPrice !== undefined) guide.regularPrice = money(b.regularPrice, 'regular price');
  if (b.destination !== undefined) {
    if (!b.destination) guide.destination = undefined;
    else {
      if (!validId(b.destination) || !(await Destination.exists({ _id: b.destination, status: 'published' }))) throw new AppError('Choose a destination from the list.', 400);
      guide.destination = b.destination;
    }
  }
  if (b.lat !== undefined || b.lng !== undefined) {
    const lat = b.lat === '' ? null : Number(b.lat);
    const lng = b.lng === '' ? null : Number(b.lng);
    if (lat === null && lng === null) guide.mapLocation = undefined;
    else {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new AppError('Enter a valid latitude and longitude.', 400);
      guide.mapLocation = { type: 'Point', coordinates: [lng, lat] };
    }
  }
  if (b.bookable !== undefined) guide.bookable = b.bookable === true || b.bookable === 'true';
  if (guide.regularPrice != null && guide.pricePerDay != null && guide.regularPrice < guide.pricePerDay) throw new AppError('The regular price cannot be lower than the price per day.', 400);
  if (guide.bookable && guide.pricePerDay == null) throw new AppError('Set a price per day so travelers can book this guide.', 400);
};

const findGuide = async (req, next) => {
  const guide = validId(req.params.id) ? await Guide.findOne({ _id: req.params.id, agency: req.agency._id }) : null;
  if (!guide) next(new AppError('No guide found on your team with that ID.', 404));
  return guide;
};

// GET /agency/me/guides — with how many upcoming tours each one leads
exports.listGuides = catchAsync(async (req, res) => {
  const guides = await Guide.find({ agency: req.agency._id }).sort({ active: -1, name: 1 }).lean();
  const counts = await Package.aggregate([
    { $match: { agency: req.agency._id, guide: { $in: guides.map(g => g._id) }, status: { $in: ['draft', 'published'] }, startDate: { $gte: new Date() } } },
    { $group: { _id: '$guide', count: { $sum: 1 } } }
  ]);
  const byGuide = new Map(counts.map(c => [String(c._id), c.count]));
  res.status(200).json({ status: 'success', data: { guides: guides.map(g => ({ ...g, upcomingTours: byGuide.get(String(g._id)) || 0 })) } });
});

exports.createGuide = catchAsync(async (req, res) => {
  const guide = new Guide({ agency: req.agency._id });
  await applyForm(guide, req.body);
  await guide.validate();
  if (req.file) guide.photo = await saveAgencyImage(req.file, req.agency._id, { width: 800, height: 800 });
  await guide.save();
  await logActivity(req, { action: 'guide.created', summary: `Guide added: ${guide.name}`, agency: req.agency._id });
  res.status(201).json({ status: 'success', data: { guide } });
});

exports.updateGuide = catchAsync(async (req, res, next) => {
  const guide = await findGuide(req, next);
  if (!guide) return;
  await applyForm(guide, req.body);
  if (req.file) {
    const old = guide.photo;
    guide.photo = await saveAgencyImage(req.file, req.agency._id, { width: 800, height: 800 });
    await removeAgencyImage(old);
  }
  if (req.body.removePhoto === 'true' || req.body.removePhoto === true) {
    await removeAgencyImage(guide.photo);
    guide.photo = '';
  }
  await guide.save();
  await logActivity(req, { action: 'guide.updated', summary: `Guide updated: ${guide.name}`, agency: req.agency._id });
  res.status(200).json({ status: 'success', data: { guide } });
});

// Removing a guide takes them off their tours (the tours stay)
exports.deleteGuide = catchAsync(async (req, res, next) => {
  const guide = await findGuide(req, next);
  if (!guide) return;
  const { modifiedCount } = await Package.updateMany({ agency: req.agency._id, guide: guide._id }, { $unset: { guide: 1 } });
  await removeAgencyImage(guide.photo);
  await guide.deleteOne();
  await logActivity(req, { action: 'guide.deleted', summary: `Guide removed: ${guide.name}${modifiedCount ? ` (taken off ${modifiedCount} tour${modifiedCount === 1 ? '' : 's'})` : ''}`, agency: req.agency._id });
  res.status(204).json({ status: 'success', data: null });
});

// ---------- Hiring a guide in the app ----------

const PLACE = { path: 'destination', select: 'name type status ancestors location', populate: { path: 'ancestors', select: 'name type' } };

const guideRatings = async ids => {
  if (!ids.length) return new Map();
  const rows = await Review.aggregate([{ $match: { guide: { $in: ids }, status: 'visible' } }, { $group: { _id: '$guide', average: { $avg: '$rating' }, count: { $sum: 1 } } }]);
  return new Map(rows.map(r => [String(r._id), { average: Math.round(r.average * 10) / 10, count: r.count }]));
};

const guideCard = (g, ratings) => {
  const place = placeView(g.destination);
  const hasPoint = l => l && l.coordinates && l.coordinates.length === 2;
  // The guide's own map position, or else the destination's
  const loc = [g.mapLocation, g.destination && g.destination.location].find(hasPoint) || null;
  return {
    ...publicGuide(g),
    title: g.title || '',
    location: place ? place.label : g.location,
    coordinates: loc ? { lat: loc.coordinates[1], lng: loc.coordinates[0] } : null,
    rating: ratings.get(String(g._id)) || { average: null, count: 0 },
    price: { ...priceView(g.pricePerDay, g.regularPrice), per: 'day' },
    agency: g.agency && g.agency.name ? { _id: g.agency._id, name: g.agency.name, logo: g.agency.logo || '', verified: Boolean(g.agency.verified) } : null
  };
};

const bookableFilter = async () => {
  const Agency = require('../models/agencyModel'); // eslint-disable-line global-require
  const agencies = (await Agency.find({ status: 'active' }).select('_id').lean()).map(a => a._id);
  return { active: true, bookable: true, pricePerDay: { $ne: null }, agency: { $in: agencies } };
};

// GET /guides?destination&q&page — guides travelers can hire
exports.listBookable = catchAsync(async (req, res, next) => {
  const filter = await bookableFilter();
  if (req.query.destination) {
    if (!validId(req.query.destination)) return next(new AppError('Unknown destination.', 400));
    const inside = await Destination.find({ ancestors: req.query.destination }).select('_id').lean();
    filter.destination = { $in: [req.query.destination, ...inside.map(d => d._id)] };
  }
  if (req.query.q) {
    const rx = { $regex: escapeRegex(String(req.query.q).trim()), $options: 'i' };
    filter.$or = [{ name: rx }, { title: rx }, { location: rx }, { languages: rx }];
  }
  const page = pageParams(req.query);
  const [rows, total] = await Promise.all([
    Guide.find(filter).sort({ experienceYears: -1, name: 1 }).skip(page.skip).limit(page.limit).populate(PLACE).populate('agency', 'name logo verified').lean(),
    Guide.countDocuments(filter)
  ]);
  const ratings = await guideRatings(rows.map(g => g._id));
  res.status(200).json({ status: 'success', data: { guides: rows.map(g => guideCard(g, ratings)), ...paged(total, page) } });
});

// GET /guides/:id — the guide's page: profile, price, reviews, and the days already taken
exports.getBookable = catchAsync(async (req, res, next) => {
  const guide = validId(req.params.id) ? await Guide.findOne({ _id: req.params.id, ...(await bookableFilter()) }).populate(PLACE).populate('agency', 'name logo verified').lean() : null;
  if (!guide) return next(new AppError('This guide is not available to book.', 404));
  const [ratings, reviews, taken] = await Promise.all([
    guideRatings([guide._id]),
    Review.find({ guide: guide._id, status: 'visible' }).sort({ createdAt: -1 }).limit(5).populate('user', 'name photo verification.status').lean(),
    Booking.find({ guide: guide._id, status: 'confirmed', endDate: { $gte: new Date() } }).select('travelDate endDate').sort({ travelDate: 1 }).limit(60).lean()
  ]);
  const { userCard } = require('../utils/social'); // eslint-disable-line global-require
  res.status(200).json({
    status: 'success',
    data: {
      guide: {
        ...guideCard(guide, ratings),
        reviews: reviews.filter(r => r.user).map(r => ({ _id: r._id, rating: r.rating, comment: r.comment, createdAt: r.createdAt, author: userCard(r.user) })),
        // Book with POST /bookings { kind: "guide", guideId, startDate, endDate, travelers }
        unavailable: taken.map(b => ({ start: b.travelDate, end: b.endDate || b.travelDate }))
      }
    }
  });
});
