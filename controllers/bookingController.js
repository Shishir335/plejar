const mongoose = require('mongoose');
const Booking = require('../models/bookingModel');
const Package = require('../models/packageModel');
const Agency = require('../models/agencyModel');
const Hotel = require('../models/hotelModel');
const Guide = require('../models/guideModel');
const Review = require('../models/reviewModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { rateFor, commissionFor } = require('../utils/commission');
const { logActivity } = require('../utils/activity');
const { HOLDS_SEAT, registrationStats, registrationClosedReason } = require('../utils/events');
const { bookingRequested, bookingStatusChanged } = require('../utils/bookingEvents');
const { PLACE_POPULATE, placeView, tourRatings, priceView } = require('../utils/tourCards');
const { claimVoucher, releaseVoucher } = require('../utils/vouchers');
const { UserVoucher } = require('../models/voucherModel');
const { hasRole } = require('../utils/roles');

// A restriction with an end date stops applying once that date has passed
const restricted = (user, what) => {
  const r = user.restrictions || {};
  if (!r[what]) return false;
  return !r.until || r.until > new Date();
};
exports.restricted = restricted;

const validId = id => mongoose.isValidObjectId(id);
const DAY = 86400000;

// A calendar day from the app (YYYY-MM-DD), stored as 00:00 UTC like tour dates
const readDay = (value, label) => {
  if (!value) throw new AppError(`Choose the ${label}.`, 400);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) throw new AppError(`Enter the ${label} as YYYY-MM-DD.`, 400);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const todayUTC = () => {
  const now = new Date(Date.now() + 6 * 3600000); // Bangladesh date
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const readCount = (value, label, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new AppError(`Enter between 1 and ${max} ${label}.`, 400);
  return n;
};

// ---------- Booking a tour, a hotel or a guide ----------

const bookTour = async (req, travelers) => {
  const pkg = validId(req.body.packageId) ? await Package.findOne({ _id: req.body.packageId, status: 'published' }) : null;
  if (!pkg) throw new AppError('That tour is not available.', 404);

  // A tour event has fixed dates and a number of seats; an undated package lets the traveler pick a date
  let travelDate;
  if (pkg.startDate) {
    const closed = registrationClosedReason(pkg);
    if (closed) throw new AppError(closed, 400);
    if (await Booking.exists({ user: req.user._id, package: pkg._id, status: { $in: HOLDS_SEAT } })) {
      throw new AppError('You are already registered for this tour event.', 400);
    }
    if (pkg.seats) {
      const taken = ((await registrationStats([pkg._id]))[String(pkg._id)] || { seatsTaken: 0 }).seatsTaken;
      const left = Math.max(pkg.seats - taken, 0);
      if (travelers > left) throw new AppError(left ? `Only ${left} seat${left === 1 ? ' is' : 's are'} left on this tour.` : 'This tour event is full.', 400);
    }
    travelDate = pkg.startDate;
  } else {
    travelDate = new Date(req.body.travelDate);
    if (Number.isNaN(travelDate.getTime()) || travelDate <= new Date()) throw new AppError('Choose a travel date in the future.', 400);
  }

  const agency = await Agency.findById(pkg.agency);
  if (!agency || agency.status !== 'active') throw new AppError('This agency is not taking bookings right now.', 400);
  const amount = pkg.priceFrom * travelers;
  const commissionRate = await rateFor(agency);
  return {
    kind: 'tour',
    agency: agency._id,
    package: pkg._id,
    packageTitle: pkg.title,
    destination: pkg.destination,
    destinationRef: pkg.destinationRef,
    travelDate,
    endDate: pkg.endDate || pkg.startDate || travelDate,
    travelers,
    pricePerPerson: pkg.priceFrom,
    regularPrice: pkg.regularPrice > pkg.priceFrom ? pkg.regularPrice : null,
    amount,
    commissionRate,
    commissionAmount: commissionFor(amount, commissionRate)
  };
};

// Hotels are listed by Plezar: Plezar confirms the stay with the hotel, so there's no agency commission
const bookHotel = async (req, travelers) => {
  const hotel = validId(req.body.hotelId) ? await Hotel.findOne({ _id: req.body.hotelId, status: 'published' }) : null;
  if (!hotel) throw new AppError('That hotel is not available.', 404);
  const checkIn = readDay(req.body.checkIn, 'check-in date');
  const checkOut = readDay(req.body.checkOut, 'check-out date');
  if (checkIn < todayUTC()) throw new AppError('Choose a check-in date from today on.', 400);
  const nights = Math.round((checkOut - checkIn) / DAY);
  if (nights < 1) throw new AppError('Check-out must be at least one night after check-in.', 400);
  if (nights > 30) throw new AppError('Book up to 30 nights at a time.', 400);
  const rooms = req.body.rooms === undefined ? 1 : readCount(req.body.rooms, 'rooms', 20);
  if (await Booking.exists({ user: req.user._id, hotel: hotel._id, status: { $in: HOLDS_SEAT }, travelDate: { $lt: checkOut }, endDate: { $gt: checkIn } })) {
    throw new AppError('You already have a booking at this hotel for some of those nights.', 400);
  }
  return {
    kind: 'hotel',
    hotel: hotel._id,
    packageTitle: hotel.name,
    destination: hotel.address,
    destinationRef: hotel.destination,
    travelDate: checkIn,
    endDate: checkOut,
    travelers,
    rooms,
    units: nights,
    pricePerPerson: hotel.pricePerNight,
    regularPrice: hotel.regularPrice > hotel.pricePerNight ? hotel.regularPrice : null,
    amount: hotel.pricePerNight * nights * rooms,
    commissionRate: 0,
    commissionAmount: 0
  };
};

// A day (or several) with one of an agency's guides; the agency confirms
const bookGuide = async (req, travelers) => {
  const guide = validId(req.body.guideId) ? await Guide.findOne({ _id: req.body.guideId, active: true, bookable: true }) : null;
  if (!guide || guide.pricePerDay == null) throw new AppError('That guide is not available to book.', 404);
  const agency = await Agency.findById(guide.agency);
  if (!agency || agency.status !== 'active') throw new AppError("This guide's agency is not taking bookings right now.", 400);
  const start = readDay(req.body.startDate, 'first day');
  const end = req.body.endDate ? readDay(req.body.endDate, 'last day') : start;
  if (start < todayUTC()) throw new AppError('Choose a day from today on.', 400);
  if (end < start) throw new AppError('The last day is before the first.', 400);
  const days = Math.round((end - start) / DAY) + 1;
  if (days > 30) throw new AppError('Book a guide for up to 30 days at a time.', 400);
  // The guide can't be in two places: a confirmed booking on any of those days blocks it
  if (await Booking.exists({ guide: guide._id, status: 'confirmed', travelDate: { $lte: end }, endDate: { $gte: start } })) {
    throw new AppError(`${guide.name} is already booked on some of those days. Try other dates.`, 400);
  }
  const amount = guide.pricePerDay * days;
  const commissionRate = await rateFor(agency);
  return {
    kind: 'guide',
    agency: agency._id,
    guide: guide._id,
    packageTitle: guide.title ? `${guide.name} - ${guide.title}` : guide.name,
    destination: guide.location,
    destinationRef: guide.destination,
    travelDate: start,
    endDate: end,
    travelers,
    units: days,
    pricePerPerson: guide.pricePerDay,
    regularPrice: guide.regularPrice > guide.pricePerDay ? guide.regularPrice : null,
    amount,
    commissionRate,
    commissionAmount: commissionFor(amount, commissionRate)
  };
};

/**
 * POST /bookings
 * Tour:  { packageId, travelers }
 * Hotel: { kind: "hotel", hotelId, checkIn, checkOut, rooms, travelers }
 * Guide: { kind: "guide", guideId, startDate, endDate, travelers }
 * Any of them can add voucherCode (a voucher redeemed in Vouchers & Rewards) for a discount.
 * Every booking starts as pending until the agency (or Plezar, for hotels) confirms it.
 */
exports.createBooking = catchAsync(async (req, res, next) => {
  if (!hasRole(req.user, 'user')) return next(new AppError('Only traveler accounts can book trips. Sign in to the Plezar app first.', 403));
  if (restricted(req.user, 'booking')) return next(new AppError('Booking is switched off for your account. Contact Plezar support.', 403));
  let kind = req.body.kind || 'tour';
  if (!req.body.kind && req.body.hotelId) kind = 'hotel';
  if (!req.body.kind && req.body.guideId) kind = 'guide';
  if (!Booking.KINDS.includes(kind)) return next(new AppError('Book a tour, a hotel or a guide.', 400));

  const travelers = Number(req.body.travelers === undefined && kind !== 'tour' ? 1 : req.body.travelers);
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 50) return next(new AppError('Enter between 1 and 50 travelers.', 400));

  const fields = await { tour: bookTour, hotel: bookHotel, guide: bookGuide }[kind](req, travelers);
  let voucher = null;
  if (String(req.body.voucherCode || '').trim()) {
    voucher = await claimVoucher(req.user._id, req.body.voucherCode, kind, fields.amount);
    // Plezar pays for the discount from its commission, so the agency's share stays the same
    fields.subtotal = fields.amount;
    fields.discountAmount = voucher.discount;
    fields.amount -= voucher.discount;
    fields.commissionAmount = Math.max(0, Math.round((fields.commissionAmount - voucher.discount) * 100) / 100);
    fields.voucher = voucher.userVoucher._id;
    fields.voucherCode = voucher.userVoucher.code;
  }
  let booking;
  try {
    booking = await Booking.create({ ...fields, user: req.user._id, note: req.body.note });
  } catch (err) {
    if (voucher) await releaseVoucher(voucher.userVoucher._id);
    throw err;
  }
  if (voucher) await UserVoucher.updateOne({ _id: voucher.userVoucher._id }, { booking: booking._id });
  await bookingRequested(booking);
  await logActivity(req, { action: 'booking.created', summary: `Booked ${booking.packageTitle} (${booking.reference}) for ${travelers} traveler${travelers === 1 ? '' : 's'}`, user: req.user._id, agency: booking.agency });

  res.status(201).json({ status: 'success', message: kind === 'hotel' ? 'Request sent. Plezar will confirm your stay with the hotel.' : 'Request sent. You will get a notification when it is confirmed.', data: { booking } });
});

// ---------- My Bookings ----------

const guideRatings = async ids => {
  if (!ids.length) return new Map();
  const rows = await Review.aggregate([{ $match: { guide: { $in: ids }, status: 'visible' } }, { $group: { _id: '$guide', average: { $avg: '$rating' }, count: { $sum: 1 } } }]);
  return new Map(rows.map(r => [String(r._id), { average: Math.round(r.average * 10) / 10, count: r.count }]));
};

const coords = loc => (loc && loc.coordinates && loc.coordinates.length === 2 ? { lat: loc.coordinates[1], lng: loc.coordinates[0] } : null);

/** Load everything the booking cards show, in a few queries */
const bookingCards = async bookings => {
  const ids = k => bookings.filter(b => b.kind === k).map(b => b[k === 'tour' ? 'package' : k]).filter(Boolean);
  const placeNested = { path: 'destination', select: 'name type status ancestors location', populate: { path: 'ancestors', select: 'name type' } };
  const [tours, hotels, guides, reviewed] = await Promise.all([
    Package.find({ _id: { $in: ids('tour') } }).select('title photos tags regularPrice destination destinationRef').populate(PLACE_POPULATE).lean(),
    Hotel.find({ _id: { $in: ids('hotel') } }).select('name photos rating location address destination').populate(placeNested).lean(),
    Guide.find({ _id: { $in: ids('guide') } }).select('name title photo location mapLocation destination').populate(placeNested).lean(),
    Review.find({ booking: { $in: bookings.map(b => b._id) } }).select('booking rating').lean()
  ]);
  const map = list => new Map(list.map(x => [String(x._id), x]));
  const byId = { tour: map(tours), hotel: map(hotels), guide: map(guides) };
  const [tRatings, gRatings] = await Promise.all([tourRatings(tours.map(t => t._id)), guideRatings(guides.map(g => g._id))]);
  const reviews = new Map(reviewed.map(r => [String(r.booking), r.rating]));

  return bookings.map(b => {
    const item = byId[b.kind].get(String(b[b.kind === 'tour' ? 'package' : b.kind])) || {};
    let photo = '';
    let place = null;
    let rating = { average: null, count: 0 };
    let tags = [];
    let coordinates = null;
    if (b.kind === 'tour') {
      photo = (item.photos || [])[0] || (item.destinationRef && item.destinationRef.coverImage) || '';
      place = placeView(item.destinationRef);
      rating = tRatings.get(String(item._id)) || rating;
      tags = item.tags || [];
    } else if (b.kind === 'hotel') {
      photo = (item.photos || [])[0] || '';
      place = placeView(item.destination);
      if (item.rating && item.rating.average != null) rating = { average: item.rating.average, count: item.rating.count || 0 };
      coordinates = coords(item.location) || coords(item.destination && item.destination.location);
    } else {
      photo = item.photo || '';
      place = placeView(item.destination);
      rating = gRatings.get(String(item._id)) || rating;
      coordinates = coords(item.mapLocation) || coords(item.destination && item.destination.location);
    }
    return {
      _id: b._id,
      reference: b.reference,
      kind: b.kind,
      status: b.status,
      title: b.packageTitle,
      itemId: item._id || null,
      photo,
      location: place ? place.label : (item.location || b.destination || ''),
      coordinates,
      rating,
      tags,
      price: priceView(b.pricePerPerson, b.regularPrice),
      per: { tour: 'person', hotel: 'night', guide: 'day' }[b.kind],
      amount: b.amount,
      discount: b.discountAmount ? { amount: b.discountAmount, voucherCode: b.voucherCode, subtotal: b.subtotal } : null,
      dates: { start: b.travelDate, end: b.endDate || b.travelDate },
      travelers: b.travelers,
      rooms: b.rooms,
      nights: b.kind === 'hotel' ? b.units : null,
      days: b.kind === 'guide' ? b.units : null,
      paymentStatus: b.paymentStatus,
      pointsEarned: b.pointsAwarded || 0,
      canCancel: ['pending', 'confirmed'].includes(b.status),
      canReview: b.status === 'completed' && !reviews.has(String(b._id)),
      myRating: reviews.get(String(b._id)) || null,
      createdAt: b.createdAt
    };
  });
};
exports.bookingCards = bookingCards;

/**
 * GET /bookings/mine?kind=tour|hotel|guide&status=pending|confirmed|completed|cancelled&page
 * "My Bookings" with the All / Tours / Hotels / Guide chips (counts for each)
 */
exports.listMyBookings = catchAsync(async (req, res) => {
  const filter = { user: req.user._id };
  if (Booking.KINDS.includes(req.query.kind)) filter.kind = req.query.kind;
  if (['pending', 'confirmed', 'completed', 'cancelled'].includes(req.query.status)) filter.status = req.query.status;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const [rows, total, counts] = await Promise.all([
    Booking.find(filter).sort({ travelDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Booking.countDocuments(filter),
    Booking.aggregate([{ $match: { user: req.user._id } }, { $group: { _id: '$kind', n: { $sum: 1 } } }])
  ]);
  const byKind = Object.fromEntries(counts.map(c => [c._id || 'tour', c.n]));
  res.status(200).json({
    status: 'success',
    results: rows.length,
    data: {
      bookings: await bookingCards(rows),
      counts: { all: counts.reduce((n, c) => n + c.n, 0), tour: byKind.tour || 0, hotel: byKind.hotel || 0, guide: byKind.guide || 0 },
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1)
    }
  });
});

exports.cancelMyBooking = catchAsync(async (req, res, next) => {
  const booking = await Booking.findOne({ _id: req.params.id, user: req.user._id });
  if (!booking) return next(new AppError('No booking found with that ID.', 404));
  if (!['pending', 'confirmed'].includes(booking.status)) {
    return next(new AppError(`A ${booking.status} booking can't be cancelled.`, 400));
  }

  const previous = booking.status;
  booking.status = 'cancelled';
  booking.cancelledAt = new Date();
  booking.cancelReason = String(req.body.reason || '').slice(0, 500);
  await booking.save();
  await bookingStatusChanged(booking, previous, { by: 'traveler' });

  await logActivity(req, { action: 'booking.cancelled', summary: `Cancelled booking ${booking.reference}`, user: req.user._id, agency: booking.agency });

  res.status(200).json({ status: 'success', data: { booking } });
});
