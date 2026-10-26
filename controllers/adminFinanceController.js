const Agency = require('../models/agencyModel');
const Booking = require('../models/bookingModel');
const Payout = require('../models/payoutModel');
const VendorCategory = require('../models/vendorCategoryModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { hasRole } = require('../utils/roles');
const { logActivity } = require('../utils/activity');
const { moveBooking } = require('../utils/bookings');
const { earningsFor, round } = require('../utils/earnings');
const { getDefaultRate } = require('../utils/commission');
const { setSetting } = require('../utils/settings');
const { escapeRegex, pageParams, paged, validId, toId } = require('../utils/query');
const { bookingStatusChanged } = require('../utils/bookingEvents');

// ---------- Bookings ----------

const bookingFilter = q => {
  const filter = {};
  if (q.agency && validId(q.agency)) filter.agency = q.agency;
  if (q.user && validId(q.user)) filter.user = q.user;
  if (['pending', 'confirmed', 'completed', 'cancelled'].includes(q.status)) filter.status = q.status;
  if (['tour', 'hotel', 'guide'].includes(q.kind)) filter.kind = q.kind;
  if (['unpaid', 'paid', 'partially_refunded', 'refunded'].includes(q.paymentStatus)) filter.paymentStatus = q.paymentStatus;
  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search).trim()), 'i');
    filter.$or = [{ reference: rx }, { packageTitle: rx }, { destination: rx }];
  }
  if (q.from || q.to) {
    filter.travelDate = {};
    if (q.from && !Number.isNaN(new Date(q.from).getTime())) filter.travelDate.$gte = new Date(q.from);
    if (q.to && !Number.isNaN(new Date(q.to).getTime())) filter.travelDate.$lte = new Date(q.to);
    if (!Object.keys(filter.travelDate).length) delete filter.travelDate;
  }
  return filter;
};

// Aggregation pipelines don't cast ID strings the way find() does
const matchForAggregate = filter => ({ ...filter, ...(filter.agency ? { agency: toId(filter.agency) } : {}), ...(filter.user ? { user: toId(filter.user) } : {}) });

exports.listBookings = catchAsync(async (req, res, next) => {
  const filter = bookingFilter(req.query);
  const pg = pageParams(req.query);
  const [bookings, total, totals] = await Promise.all([
    Booking.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('user', 'name email').populate('agency', 'name').lean(),
    Booking.countDocuments(filter),
    Booking.aggregate([{ $match: matchForAggregate(filter) }, { $group: { _id: null, amount: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' } } }])
  ]);
  const t = totals[0] || { amount: 0, commission: 0 };
  res.status(200).json({ status: 'success', data: { bookings, totals: { amount: round(t.amount), commission: round(t.commission) }, ...paged(total, pg) } });
});

exports.updateBooking = catchAsync(async (req, res, next) => {
  const booking = validId(req.params.id) ? await Booking.findById(req.params.id) : null;
  if (!booking) return next(new AppError('No booking found with that ID.', 404));

  const { status, paymentStatus } = req.body;
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  const changes = [];

  if (paymentStatus !== undefined && paymentStatus !== booking.paymentStatus) {
    // Only administrators and developers change money state
    if (!hasRole(req.user, 'admin', 'dev')) {
      return next(new AppError('Only administrators can change payment status.', 403));
    }
    if (!['paid', 'unpaid'].includes(paymentStatus)) {
      return next(new AppError('Payment status can be set to paid or unpaid here. Refunds are handled separately.', 400));
    }
    if (['refunded', 'partially_refunded'].includes(booking.paymentStatus)) {
      return next(new AppError('This booking has been refunded, so its payment status is locked.', 400));
    }
    if (booking.status === 'cancelled' && paymentStatus === 'paid') {
      return next(new AppError('A cancelled booking cannot be marked paid.', 400));
    }
    booking.paymentStatus = paymentStatus;
    booking.paidAt = paymentStatus === 'paid' ? new Date() : undefined;
    changes.push(`payment ${paymentStatus}`);
  }

  const previous = booking.status;
  if (status !== undefined && status !== booking.status) {
    moveBooking(booking, status, { reason });
    changes.push(`status ${status}`);
  }

  if (!changes.length) return next(new AppError('Nothing to change.', 400));
  await booking.save();
  await bookingStatusChanged(booking, previous, { by: 'admin' });

  await logActivity(req, { action: 'booking.admin_update', summary: `Booking ${booking.reference}: ${changes.join(', ')}${reason ? `. ${reason}` : ''}`, user: booking.user, agency: booking.agency });
  res.status(200).json({ status: 'success', data: { booking } });
});

// ---------- Payouts ----------

exports.listPayouts = catchAsync(async (req, res, next) => {
  const q = req.query;
  const filter = {};
  if (['pending', 'paid', 'rejected'].includes(q.status)) filter.status = q.status;
  if (q.agency && validId(q.agency)) filter.agency = q.agency;
  if (q.search) {
    const matches = await Agency.find({ name: new RegExp(escapeRegex(String(q.search).trim()), 'i') }).select('_id');
    filter.agency = { $in: matches.map(a => a._id) };
  }
  const pg = pageParams(q);
  const [payouts, total, sums] = await Promise.all([
    Payout.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('agency', 'name').populate('decidedBy', 'name').lean(),
    Payout.countDocuments(filter),
    Payout.aggregate([{ $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } }])
  ]);
  const totals = Object.fromEntries(sums.map(s => [s._id, { amount: round(s.amount), count: s.count }]));
  res.status(200).json({ status: 'success', data: { payouts, totals, ...paged(total, pg) } });
});

exports.createPayout = catchAsync(async (req, res, next) => {
  const agency = validId(req.params.id) ? await Agency.findById(req.params.id) : null;
  if (!agency) return next(new AppError('No vendor found with that ID.', 404));

  const amount = round(Number(req.body.amount));
  if (!(amount >= 1)) return next(new AppError('Enter an amount of at least ৳1.', 400));
  const earnings = await earningsFor(agency._id);
  if (amount > earnings.available) {
    return next(new AppError(`Only ৳${earnings.available} is available for payout. The vendor earns from completed, paid trips.`, 400));
  }

  const payout = await Payout.create({
    agency: agency._id, amount, method: req.body.method, account: req.body.account, note: req.body.note, source: 'admin', requestedBy: req.user._id
  });
  await logActivity(req, { action: 'payout.created', summary: `Payout of ৳${amount} created via ${payout.method}`, agency: agency._id });
  res.status(201).json({ status: 'success', data: { payout } });
});

exports.decidePayout = catchAsync(async (req, res, next) => {
  const payout = validId(req.params.id) ? await Payout.findById(req.params.id) : null;
  if (!payout) return next(new AppError('No payout found with that ID.', 404));
  if (payout.status !== 'pending') return next(new AppError(`This payout is already ${payout.status}.`, 400));

  const { action } = req.body;
  if (action === 'mark_paid') {
    const reference = String(req.body.reference || '').trim().slice(0, 120);
    if (reference.length < 3) return next(new AppError('Enter the transaction ID from bKash, Nagad or the bank.', 400));
    payout.status = 'paid';
    payout.reference = reference;
    payout.paidAt = new Date();
  } else if (action === 'reject') {
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (reason.length < 3) return next(new AppError('Add a reason. The vendor sees it.', 400));
    payout.status = 'rejected';
    payout.rejectedReason = reason;
  } else {
    return next(new AppError('Action must be mark_paid or reject.', 400));
  }
  payout.decidedBy = req.user._id;
  payout.decidedAt = new Date();
  await payout.save();

  await logActivity(req, { action: `payout.${payout.status}`, summary: payout.status === 'paid' ? `Payout of ৳${payout.amount} marked paid (${payout.reference})` : `Payout of ৳${payout.amount} rejected: ${payout.rejectedReason}`, agency: payout.agency });
  res.status(200).json({ status: 'success', data: { payout } });
});

exports.vendorPayouts = catchAsync(async (req, res, next) => {
  if (!validId(req.params.id)) return next(new AppError('No vendor found with that ID.', 404));
  const [payouts, earnings] = await Promise.all([
    Payout.find({ agency: req.params.id }).sort({ createdAt: -1 }).limit(100).populate('decidedBy', 'name').lean(),
    earningsFor(req.params.id)
  ]);
  res.status(200).json({ status: 'success', data: { payouts, earnings } });
});

// ---------- Vendor categories ----------

exports.listCategories = catchAsync(async (req, res, next) => {
  const [categories, counts] = await Promise.all([
    VendorCategory.find().sort({ name: 1 }).lean(),
    Agency.aggregate([{ $unwind: '$categories' }, { $group: { _id: '$categories', count: { $sum: 1 } } }])
  ]);
  const map = new Map(counts.map(c => [String(c._id), c.count]));
  res.status(200).json({ status: 'success', data: { categories: categories.map(c => ({ ...c, vendors: map.get(String(c._id)) || 0 })) } });
});

exports.createCategory = catchAsync(async (req, res, next) => {
  const category = await VendorCategory.create({ name: req.body.name, description: req.body.description });
  await logActivity(req, { action: 'category.created', summary: `Created vendor category "${category.name}"` });
  res.status(201).json({ status: 'success', data: { category } });
});

exports.updateCategory = catchAsync(async (req, res, next) => {
  const category = validId(req.params.id) ? await VendorCategory.findById(req.params.id) : null;
  if (!category) return next(new AppError('No category found with that ID.', 404));
  ['name', 'description'].forEach(f => { if (req.body[f] !== undefined) category[f] = req.body[f]; });
  if (req.body.active !== undefined) category.active = req.body.active === true || req.body.active === 'true';
  await category.save();
  res.status(200).json({ status: 'success', data: { category } });
});

exports.deleteCategory = catchAsync(async (req, res, next) => {
  const category = validId(req.params.id) ? await VendorCategory.findById(req.params.id) : null;
  if (!category) return next(new AppError('No category found with that ID.', 404));
  const used = await Agency.countDocuments({ categories: category._id });
  if (used) {
    return next(new AppError(`${used} vendor${used === 1 ? ' uses' : 's use'} this category. Remove it from them first, or switch it off instead of deleting.`, 400));
  }
  await category.deleteOne();
  await logActivity(req, { action: 'category.deleted', summary: `Deleted vendor category "${category.name}"` });
  res.status(204).json({ status: 'success', data: null });
});

// ---------- Platform commission setting ----------

exports.getCommissionSetting = catchAsync(async (req, res, next) => {
  res.status(200).json({ status: 'success', data: { defaultRate: await getDefaultRate() } });
});

exports.setCommissionSetting = catchAsync(async (req, res, next) => {
  const rate = Number(req.body.defaultRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return next(new AppError('The default commission must be between 0% and 100%.', 400));
  }
  const before = await getDefaultRate();
  await setSetting('commissionRate', rate, req.user._id);
  await logActivity(req, { action: 'settings.commission', summary: `Platform default commission changed from ${before}% to ${rate}%. Applies to new bookings from vendors without their own rate.` });
  res.status(200).json({ status: 'success', data: { defaultRate: rate } });
});
