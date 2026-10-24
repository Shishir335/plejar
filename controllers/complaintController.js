const Complaint = require('../models/complaintModel');
const Booking = require('../models/bookingModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');

exports.createComplaint = catchAsync(async (req, res, next) => {
  const { category, subject, message, againstAgency, againstUser, bookingId } = req.body;

  let booking = null;
  if (bookingId) {
    booking = await Booking.findOne({ _id: bookingId, user: req.user._id });
    if (!booking) return next(new AppError('No booking found with that ID.', 404));
  }
  if (againstUser && String(againstUser) === String(req.user._id)) {
    return next(new AppError("You can't report yourself.", 400));
  }

  const complaint = await Complaint.create({
    reporter: req.user._id,
    againstUser,
    againstAgency: againstAgency || (booking && booking.agency),
    booking: booking ? booking._id : undefined,
    category,
    subject,
    message
  });

  await logActivity(req, { action: 'complaint.created', summary: `Reported a problem: ${complaint.subject}`, user: req.user._id, agency: complaint.againstAgency });

  res.status(201).json({
    status: 'success',
    message: 'Thanks. Our team will look into this and get back to you.',
    data: { complaint: { id: complaint._id, status: complaint.status, createdAt: complaint.createdAt } }
  });
});

exports.listMyComplaints = catchAsync(async (req, res, next) => {
  const complaints = await Complaint.find({ reporter: req.user._id }).sort({ createdAt: -1 }).select('-internalNote');
  res.status(200).json({ status: 'success', results: complaints.length, data: { complaints } });
});
