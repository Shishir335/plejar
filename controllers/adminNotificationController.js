const User = require('../models/userModel');
const Notification = require('../models/notificationModel');
const Broadcast = require('../models/broadcastModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { sendPushNotification } = require('../utils/pushNotification');
const { logActivity } = require('../utils/activity');
const { pageParams, paged } = require('../utils/query');

/**
 * Returns audience sizing and FCM token statistics across the platform.
 */
exports.getStats = catchAsync(async (req, res) => {
  const activeFilter = { status: 'active', isDeleted: { $ne: true } };

  const [
    totalUsers,
    travelersCount,
    travelersWithFcm,
    vendorsCount,
    vendorsWithFcm,
    totalTokensResult
  ] = await Promise.all([
    User.countDocuments(activeFilter),
    User.countDocuments({ ...activeFilter, $or: [{ roles: 'user' }, { role: 'user' }] }),
    User.countDocuments({
      ...activeFilter,
      $or: [{ roles: 'user' }, { role: 'user' }],
      'fcmTokens.0': { $exists: true }
    }),
    User.countDocuments({ ...activeFilter, $or: [{ roles: 'agent' }, { role: 'agent' }] }),
    User.countDocuments({
      ...activeFilter,
      $or: [{ roles: 'agent' }, { role: 'agent' }],
      'fcmTokens.0': { $exists: true }
    }),
    User.aggregate([
      { $match: { ...activeFilter, 'fcmTokens.0': { $exists: true } } },
      { $project: { tokenCount: { $size: '$fcmTokens' } } },
      { $group: { _id: null, total: { $sum: '$tokenCount' } } }
    ])
  ]);

  const totalTokens = (totalTokensResult[0] && totalTokensResult[0].total) || 0;

  res.status(200).json({
    status: 'success',
    data: {
      totalUsers,
      travelersCount,
      travelersWithFcm,
      vendorsCount,
      vendorsWithFcm,
      totalTokens
    }
  });
});

/**
 * Returns paginated history of broadcasts sent by Admins and Vendors.
 */
exports.getHistory = catchAsync(async (req, res) => {
  const page = pageParams(req.query, 20);
  const filter = {};

  if (req.query.scope === 'admin') {
    filter.scope = 'admin';
  } else if (req.query.scope === 'agency') {
    filter.scope = 'agency';
  }

  const [broadcasts, total] = await Promise.all([
    Broadcast.find(filter)
      .sort({ createdAt: -1 })
      .skip(page.skip)
      .limit(page.limit)
      .populate('agency', 'name logo')
      .populate('sentBy', 'name email role')
      .lean(),
    Broadcast.countDocuments(filter)
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      broadcasts,
      ...paged(total, page)
    }
  });
});

/**
 * Sends a notification broadcast from Master Admin to Users, Vendors, or Everyone.
 */
exports.sendBroadcast = catchAsync(async (req, res, next) => {
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const audience = String(req.body.audience || '').trim();
  const route = String(req.body.route || '/notifications').trim();
  const imageUrl = req.body.imageUrl ? String(req.body.imageUrl).trim() : null;
  const testEmail = req.body.testEmail ? String(req.body.testEmail).trim().toLowerCase() : null;

  if (!title) return next(new AppError('Please provide a notification title.', 400));
  if (title.length > 120) return next(new AppError('Notification title must be 120 characters or fewer.', 400));
  if (!body) return next(new AppError('Please provide a notification message.', 400));
  if (body.length > 1000) return next(new AppError('Notification message must be 1000 characters or fewer.', 400));

  const validAudiences = ['users', 'vendors', 'all', 'test'];
  if (!validAudiences.includes(audience)) {
    return next(new AppError('Invalid audience. Choose "users", "vendors", "all", or "test".', 400));
  }

  const activeFilter = { status: 'active', isDeleted: { $ne: true } };
  let recipientIds = [];

  if (audience === 'test') {
    if (!testEmail) {
      return next(new AppError('Please provide a test account email address.', 400));
    }
    const targetUser = await User.findOne({ email: testEmail }).select('_id name email');
    if (!targetUser) {
      return next(new AppError(`No user found with email: ${testEmail}`, 404));
    }
    recipientIds = [targetUser._id];
  } else if (audience === 'users') {
    recipientIds = await User.distinct('_id', {
      ...activeFilter,
      $or: [{ roles: 'user' }, { role: 'user' }]
    });
  } else if (audience === 'vendors') {
    recipientIds = await User.distinct('_id', {
      ...activeFilter,
      $or: [{ roles: 'agent' }, { role: 'agent' }]
    });
  } else if (audience === 'all') {
    recipientIds = await User.distinct('_id', activeFilter);
  }

  if (!recipientIds.length) {
    return next(new AppError(`No active recipients found for audience "${audience}".`, 400));
  }

  // Respect user notification preferences
  const optedOut = new Set(
    (await User.find({
      _id: { $in: recipientIds },
      'settings.notifications.tours': false
    }).select('_id').lean()).map(u => String(u._id))
  );
  const eligibleRecipients = recipientIds.filter(id => !optedOut.has(String(id)));

  if (!eligibleRecipients.length) {
    return next(new AppError('All target recipients have opted out of notifications in their settings.', 400));
  }

  // Create Broadcast log record
  const broadcast = await Broadcast.create({
    agency: null,
    scope: 'admin',
    audience,
    title,
    body,
    recipientCount: eligibleRecipients.length,
    sentBy: req.user._id,
    sentByName: req.user.name || 'Master Admin'
  });

  // Batch insert in-app notifications
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < eligibleRecipients.length; i += CHUNK_SIZE) {
    const chunk = eligibleRecipients.slice(i, i + CHUNK_SIZE);
    await Notification.insertMany(
      chunk.map(userId => ({
        user: userId,
        kind: 'admin_broadcast',
        title,
        body,
        broadcast: broadcast._id
      })),
      { ordered: false }
    ).catch(() => {});
  }

  // Send Firebase Push Notifications
  let pushStats = { sent: 0, failed: 0, total: 0 };
  try {
    const pushResult = await sendPushNotification({
      userIds: eligibleRecipients,
      title,
      body,
      imageUrl: imageUrl || undefined,
      data: {
        kind: 'admin_broadcast',
        broadcastId: String(broadcast._id),
        route: route || '/notifications'
      }
    });
    if (pushResult) {
      pushStats = pushResult;
      broadcast.pushStats = pushResult;
      await broadcast.save();
    }
  } catch (err) {
    console.error('[Admin Push Notification Error]:', err.message);
  }

  // Log to admin activity
  let audDescription = 'all users & vendors';
  if (audience === 'users') audDescription = 'all travelers';
  else if (audience === 'vendors') audDescription = 'all vendors';
  else if (audience === 'test') audDescription = `test email ${testEmail}`;

  await logActivity(req, {
    action: 'admin.broadcast.sent',
    summary: `Sent broadcast "${title}" to ${eligibleRecipients.length} account${eligibleRecipients.length === 1 ? '' : 's'} (${audDescription}). FCM sent: ${pushStats.sent}, failed: ${pushStats.failed}.`
  });

  res.status(201).json({
    status: 'success',
    message: `Notification sent to ${eligibleRecipients.length} account${eligibleRecipients.length === 1 ? '' : 's'} (${pushStats.sent} push notifications delivered).`,
    data: {
      broadcast,
      recipientsCount: eligibleRecipients.length,
      pushStats
    }
  });
});
