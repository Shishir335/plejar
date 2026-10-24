const Booking = require('../models/bookingModel');
const Package = require('../models/packageModel');
const Agency = require('../models/agencyModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { rateFor, commissionFor } = require('../utils/commission');
const { logActivity } = require('../utils/activity');

// A restriction with an end date stops applying once that date has passed
const restricted = (user, what) => {
  const r = user.restrictions || {};
  if (!r[what]) return false;
  return !r.until || r.until > new Date();
};
exports.restricted = restricted;

exports.createBooking = catchAsync(async (req, res, next) => {
  if (req.user.role !== 'user') {
    return next(new AppError('Only traveler accounts can book trips.', 403));
  }
  if (restricted(req.user, 'booking')) {
    return next(new AppError('Booking is switched off for your account. Contact Plezar support.', 403));
  }

  const travelers = Number(req.body.travelers);
  const travelDate = new Date(req.body.travelDate);
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 50) {
    return next(new AppError('Enter between 1 and 50 travelers.', 400));
  }
  if (Number.isNaN(travelDate.getTime()) || travelDate <= new Date()) {
    return next(new AppError('Choose a travel date in the future.', 400));
  }

  const pkg = await Package.findOne({ _id: req.body.packageId, status: 'published' });
  if (!pkg) return next(new AppError('That tour package is not available.', 404));

  const agency = await Agency.findById(pkg.agency);
  if (!agency || agency.status !== 'active') {
    return next(new AppError('This agency is not taking bookings right now.', 400));
  }

  const amount = pkg.priceFrom * travelers;
  const commissionRate = await rateFor(agency);

  const booking = await Booking.create({
    user: req.user._id,
    agency: agency._id,
    package: pkg._id,
    packageTitle: pkg.title,
    destination: pkg.destination,
    destinationRef: pkg.destinationRef,
    travelDate,
    travelers,
    pricePerPerson: pkg.priceFrom,
    amount,
    commissionRate,
    commissionAmount: commissionFor(amount, commissionRate),
    note: req.body.note
  });

  await logActivity(req, { action: 'booking.created', summary: `Booked ${pkg.title} (${booking.reference}) for ${travelers} traveler${travelers === 1 ? '' : 's'}`, user: req.user._id, agency: agency._id });

  res.status(201).json({ status: 'success', data: { booking } });
});

exports.listMyBookings = catchAsync(async (req, res, next) => {
  const bookings = await Booking.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.status(200).json({ status: 'success', results: bookings.length, data: { bookings } });
});

exports.cancelMyBooking = catchAsync(async (req, res, next) => {
  const booking = await Booking.findOne({ _id: req.params.id, user: req.user._id });
  if (!booking) return next(new AppError('No booking found with that ID.', 404));
  if (!['pending', 'confirmed'].includes(booking.status)) {
    return next(new AppError(`A ${booking.status} booking can't be cancelled.`, 400));
  }

  booking.status = 'cancelled';
  booking.cancelledAt = new Date();
  booking.cancelReason = String(req.body.reason || '').slice(0, 500);
  await booking.save();

  await logActivity(req, { action: 'booking.cancelled', summary: `Cancelled booking ${booking.reference}`, user: req.user._id, agency: booking.agency });

  res.status(200).json({ status: 'success', data: { booking } });
});
