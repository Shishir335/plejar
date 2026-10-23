const validator = require('validator');
const Subscriber = require('../models/subscriberModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

// 1. PUBLIC: Subscribe to newsletter / drop alerts
exports.subscribe = catchAsync(async (req, res, next) => {
  const { email, source } = req.body;

  if (!email || !validator.isEmail(email.trim())) {
    return next(new AppError('Please provide a valid email address.', 400));
  }

  const cleanEmail = email.trim().toLowerCase();
  const existingSubscriber = await Subscriber.findOne({ email: cleanEmail });

  if (existingSubscriber) {
    if (existingSubscriber.status === 'unsubscribed') {
      existingSubscriber.status = 'active';
      if (source) existingSubscriber.source = source;
      await existingSubscriber.save();
      return res.status(200).json({
        status: 'success',
        isNew: false,
        message: 'Welcome back! Your newsletter subscription has been reactivated.'
      });
    }

    return res.status(200).json({
      status: 'success',
      isNew: false,
      message: 'You are already subscribed to our newsletter!'
    });
  }

  const newSubscriber = await Subscriber.create({
    email: cleanEmail,
    source: source || 'newsletter',
    ipAddress: req.ip || ''
  });

  res.status(201).json({
    status: 'success',
    isNew: true,
    message: 'Successfully subscribed to the newsletter!',
    data: {
      subscriber: {
        id: newSubscriber._id,
        email: newSubscriber.email,
        createdAt: newSubscriber.createdAt
      }
    }
  });
});

// 2. ADMIN: Get all subscribers
exports.getAllSubscribers = catchAsync(async (req, res, next) => {
  const query = {};
  if (req.query.search) {
    query.email = { $regex: req.query.search.trim(), $options: 'i' };
  }
  if (req.query.status) {
    query.status = req.query.status;
  }

  const subscribers = await Subscriber.find(query).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: subscribers.length,
    data: {
      subscribers
    }
  });
});

// 3. ADMIN: Delete subscriber
exports.deleteSubscriber = catchAsync(async (req, res, next) => {
  const subscriber = await Subscriber.findByIdAndDelete(req.params.id);

  if (!subscriber) {
    return next(new AppError('No subscriber found with that ID', 404));
  }

  res.status(204).json({
    status: 'success',
    data: null
  });
});

// 4. ADMIN: Export subscribers to CSV for Meta Ads / Email Blasts
exports.exportSubscribersCSV = catchAsync(async (req, res, next) => {
  const subscribers = await Subscriber.find({ status: 'active' }).sort({ createdAt: -1 });

  let csv = 'Email,Status,Source,Date Subscribed\n';
  subscribers.forEach(sub => {
    const date = sub.createdAt ? sub.createdAt.toISOString().split('T')[0] : '';
    csv += `"${sub.email}","${sub.status}","${sub.source || 'newsletter'}","${date}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="subscribers-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.status(200).send(csv);
});
