const Booking = require('../models/bookingModel');
const Review = require('../models/reviewModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { restricted } = require('./bookingController');
const { logActivity } = require('../utils/activity');

exports.createReview = catchAsync(async (req, res, next) => {
  if (restricted(req.user, 'reviews')) {
    return next(new AppError('Writing reviews is switched off for your account. Contact Plezar support.', 403));
  }

  const booking = await Booking.findOne({ _id: req.body.bookingId, user: req.user._id });
  if (!booking) return next(new AppError('No booking found with that ID.', 404));
  if (booking.status !== 'completed') {
    return next(new AppError('You can review a trip after it is completed.', 400));
  }
  if (await Review.exists({ booking: booking._id })) {
    return next(new AppError('You have already reviewed this booking.', 400));
  }

  const review = await Review.create({
    user: req.user._id,
    agency: booking.agency,
    package: booking.package,
    booking: booking._id,
    rating: req.body.rating,
    comment: req.body.comment
  });

  await logActivity(req, { action: 'review.created', summary: `Reviewed ${booking.packageTitle}: ${review.rating} out of 5`, user: req.user._id, agency: booking.agency });

  res.status(201).json({ status: 'success', data: { review } });
});
