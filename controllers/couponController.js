const mongoose = require('mongoose');
const { Coupon, CouponRedemption } = require('../models/couponModel');
const Package = require('../models/packageModel');
const Guide = require('../models/guideModel');
const Hotel = require('../models/hotelModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { normalizeCode, checkCoupon, availableCoupons, couponCard, offerLabel } = require('../utils/coupons');
const { logActivity } = require('../utils/activity');
const { pageParams, paged } = require('../utils/query');

/**
 * Coupons: Plejar's (admin panel, Plejar pays the discount), a tour agency's or hotel's own (their
 * panel, they pay it), and checking or listing them from the app's booking screens. Using a coupon
 * happens when the booking or stay request is made (bookingController, stayController).
 */

const validId = id => mongoose.isValidObjectId(id);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A date from a panel (YYYY-MM-DD) as the start or end of that day in Bangladesh
const dhakaDay = (value, end) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const v = String(value).slice(0, 10);
  if (!DAY.test(v)) throw new AppError('Enter dates as YYYY-MM-DD.', 400);
  const d = new Date(`${v}T${end ? '23:59:59.999' : '00:00:00'}+06:00`);
  if (Number.isNaN(d.getTime())) throw new AppError('Enter dates as YYYY-MM-DD.', 400);
  return d;
};

const num = (value, label, { min = 0, allowEmpty = false } = {}) => {
  if (value === undefined) return undefined;
  if (allowEmpty && (value === null || value === '')) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) throw new AppError(`Enter a valid ${label}.`, 400);
  return n;
};

/**
 * The fields a panel can set. `owner` is the vendor (agency or hotel account) for a vendor's own
 * coupon, null for Plejar's. Only fields present in the body are returned, so it works for edits.
 */
const readInput = async (b, owner, currentVendor = null) => {
  const out = {};
  if (b.code !== undefined) out.code = normalizeCode(b.code);
  if (b.title !== undefined) out.title = text(b.title, 80);
  if (b.description !== undefined) out.description = text(b.description, 500);
  if (b.discountType !== undefined) out.discountType = b.discountType === 'amount' ? 'amount' : 'percent';
  if (b.value !== undefined) out.value = num(b.value, 'discount', { min: 1 });
  if (b.maxDiscount !== undefined) out.maxDiscount = num(b.maxDiscount, 'limit', { min: 1, allowEmpty: true });
  if (b.minSpend !== undefined) out.minSpend = num(b.minSpend === '' || b.minSpend === null ? 0 : b.minSpend, 'minimum spend');
  if (b.usageLimit !== undefined) out.usageLimit = num(b.usageLimit, 'number of uses', { min: 1, allowEmpty: true });
  if (b.perUserLimit !== undefined) out.perUserLimit = num(b.perUserLimit || 1, 'uses per traveler', { min: 1 });
  if (b.startsAt !== undefined) out.startsAt = dhakaDay(b.startsAt, false);
  if (b.endsAt !== undefined) out.endsAt = dhakaDay(b.endsAt, true);
  if (b.visible !== undefined) out.visible = b.visible === true || b.visible === 'true';
  if (b.status !== undefined) out.status = b.status === 'paused' ? 'paused' : 'active';

  // What it applies to: a hotel's coupons are for its stays; an agency's for its tours and guides
  let allowed = Coupon.KINDS;
  if (owner) allowed = owner.kind === 'hotel' ? ['hotel'] : ['tour', 'guide'];
  if (b.appliesTo !== undefined) {
    const kinds = [].concat(b.appliesTo).map(String).filter(k => allowed.includes(k));
    out.appliesTo = [...new Set(kinds)];
  } else if (owner && owner.kind === 'hotel') {
    out.appliesTo = ['hotel'];
  }

  if (!owner && b.vendor !== undefined) out.vendor = validId(b.vendor) ? b.vendor : null;
  let vendorId = out.vendor === undefined ? currentVendor : out.vendor;
  if (owner) vendorId = owner._id;
  if (b.packages !== undefined) {
    const ids = [].concat(b.packages || []).map(String).filter(validId);
    if (ids.length && !vendorId) throw new AppError('Choose the agency first to limit the coupon to some of its tours.', 400);
    // Only that agency's own tours
    out.packages = ids.length ? (await Package.find({ _id: { $in: ids }, agency: vendorId }).select('_id').lean()).map(p => p._id) : [];
    if (out.packages.length !== ids.length) throw new AppError("Some of those tours aren't this agency's.", 400);
  }
  return out;
};

// The coupon with how it has been used: uses still counted and the taka they took off
const withUsage = async coupons => {
  const ids = coupons.map(c => c._id);
  const rows = ids.length ? await CouponRedemption.aggregate([
    { $match: { coupon: { $in: ids } } },
    { $group: {
      _id: '$coupon',
      uses: { $sum: { $cond: [{ $eq: ['$status', 'applied'] }, 1, 0] } },
      discount: { $sum: { $cond: [{ $eq: ['$status', 'applied'] }, '$discount', 0] } },
      ever: { $sum: 1 }
    } }
  ]) : [];
  const map = new Map(rows.map(r => [String(r._id), r]));
  const now = new Date();
  return coupons.map(c => {
    const o = c.toObject ? c.toObject() : c;
    const u = map.get(String(c._id)) || { uses: 0, discount: 0, ever: 0 };
    let state = o.status;
    if (o.blockedByAdmin) state = 'blocked';
    else if (o.status === 'active' && o.endsAt && o.endsAt < now) state = 'ended';
    else if (o.status === 'active' && o.startsAt && o.startsAt > now) state = 'scheduled';
    else if (o.status === 'active' && o.usageLimit != null && o.usedCount >= o.usageLimit) state = 'used_up';
    // everUsed: used at least once, even if given back since; such a coupon keeps its code and can't be deleted
    return { ...o, label: offerLabel(o), state, uses: u.uses, discountGiven: u.discount, everUsed: u.ever > 0 };
  });
};

const saveError = err => {
  if (err && err.code === 11000) return new AppError('That code is already taken. Choose another one.', 409);
  return err;
};

// ---------- The app: coupons on a booking screen ----------

// Who runs the thing being booked: { kind, vendor, packageId }
const bookingTarget = async q => {
  const kind = ['tour', 'guide', 'hotel'].includes(q.kind) ? q.kind : null;
  if (!kind) throw new AppError('Say what is being booked: a tour, a guide or a hotel.', 400);
  if (kind === 'tour') {
    const pkg = validId(q.packageId) ? await Package.findOne({ _id: q.packageId, status: 'published' }).select('agency').lean() : null;
    if (!pkg) throw new AppError('That tour is not available.', 404);
    return { kind, vendor: pkg.agency, packageId: pkg._id };
  }
  if (kind === 'guide') {
    const guide = validId(q.guideId) ? await Guide.findOne({ _id: q.guideId, active: true }).select('agency').lean() : null;
    if (!guide) throw new AppError('That guide is not available.', 404);
    return { kind, vendor: guide.agency };
  }
  const hotel = validId(q.hotelId) ? await Hotel.findOne({ _id: q.hotelId, status: 'published' }).select('agency').lean() : null;
  if (!hotel) throw new AppError('That hotel is not available.', 404);
  return { kind, vendor: hotel.agency || null };
};

const subtotalOf = value => {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// GET /api/v1/coupons/available?kind=tour&packageId=…&subtotal=12000 (guideId, hotelId for the others)
exports.available = catchAsync(async (req, res) => {
  const target = await bookingTarget(req.query);
  const coupons = await availableCoupons({ ...target, user: req.user._id, subtotal: subtotalOf(req.query.subtotal) });
  res.status(200).json({ status: 'success', results: coupons.length, data: { coupons } });
});

// POST /api/v1/coupons/check { code, kind, packageId | guideId | hotelId, subtotal }
// What the coupon would take off, without using it. It is used when the booking is sent.
exports.check = catchAsync(async (req, res) => {
  const b = req.body || {};
  const target = await bookingTarget(b);
  const subtotal = subtotalOf(b.subtotal);
  if (!subtotal) throw new AppError('Choose your dates and travelers first.', 400);
  const { coupon, discount } = await checkCoupon(b.code, { ...target, user: req.user._id, subtotal });
  res.status(200).json({
    status: 'success',
    message: `${coupon.code} applied: ${offerLabel(coupon)}.`,
    data: { coupon: couponCard(coupon, subtotal), subtotal, discount, total: subtotal - discount }
  });
});

// ---------- A vendor's own coupons (agency panel and hotel panel) ----------

const findOwn = async req => {
  const coupon = validId(req.params.id) ? await Coupon.findOne({ _id: req.params.id, vendor: req.agency._id, fundedBy: 'vendor' }) : null;
  if (!coupon) throw new AppError('No coupon found with that ID.', 404);
  return coupon;
};

exports.listMine = catchAsync(async (req, res) => {
  const coupons = await Coupon.find({ vendor: req.agency._id, fundedBy: 'vendor' }).sort({ createdAt: -1 }).populate('packages', 'title');
  const tours = req.agency.kind === 'hotel' ? [] : await Package.find({ agency: req.agency._id, status: { $in: ['published', 'draft'] } }).sort({ updatedAt: -1 }).limit(200).select('title').lean();
  res.status(200).json({ status: 'success', data: { coupons: await withUsage(coupons), tours, kind: req.agency.kind === 'hotel' ? 'hotel' : 'agency' } });
});

exports.createMine = catchAsync(async (req, res) => {
  const fields = await readInput(req.body || {}, req.agency);
  if (!fields.appliesTo || !fields.appliesTo.length) fields.appliesTo = req.agency.kind === 'hotel' ? ['hotel'] : ['tour', 'guide'];
  let coupon;
  try {
    coupon = await Coupon.create({ ...fields, vendor: req.agency._id, fundedBy: 'vendor', createdBy: req.user._id });
  } catch (err) { throw saveError(err); }
  await logActivity(req, { action: 'coupon.created', summary: `Made coupon ${coupon.code} (${offerLabel(coupon)})`, agency: req.agency._id });
  res.status(201).json({ status: 'success', message: `${coupon.code} is ${coupon.status === 'active' ? 'live' : 'saved, paused'}. Its discounts come out of your earnings.`, data: { coupon: (await withUsage([coupon]))[0] } });
});

// Changing a coupon only affects bookings from now on; the code can't change once it has been used
const applyEdit = async (coupon, fields) => {
  if (fields.code && fields.code !== coupon.code && coupon.usedCount + (await CouponRedemption.countDocuments({ coupon: coupon._id })) > 0) {
    throw new AppError("This coupon has been used, so its code can't change. Pause it and make a new one.", 400);
  }
  Object.assign(coupon, fields);
  try { await coupon.save(); } catch (err) { throw saveError(err); }
};

exports.updateMine = catchAsync(async (req, res) => {
  const coupon = await findOwn(req);
  await applyEdit(coupon, await readInput(req.body || {}, req.agency));
  res.status(200).json({ status: 'success', data: { coupon: (await withUsage([coupon]))[0] } });
});

// Only a coupon nobody has used can be deleted; a used one is paused instead, to keep its history
exports.deleteMine = catchAsync(async (req, res) => {
  const coupon = await findOwn(req);
  if (await CouponRedemption.exists({ coupon: coupon._id })) throw new AppError('This coupon has been used, so it stays in your history. Pause it instead.', 400);
  await Coupon.deleteOne({ _id: coupon._id });
  res.status(204).json({});
});

// ---------- Admin: Plejar's coupons, and every vendor's ----------

exports.adminList = catchAsync(async (req, res) => {
  const q = req.query;
  const filter = {};
  if (q.source === 'plejar') filter.fundedBy = 'plejar';
  if (q.source === 'vendor') filter.fundedBy = 'vendor';
  if (validId(q.vendor)) filter.vendor = q.vendor;
  if (q.status === 'blocked') filter.blockedByAdmin = true;
  else if (q.status === 'paused') filter.status = 'paused';
  else if (q.status === 'active') { filter.status = 'active'; filter.blockedByAdmin = { $ne: true }; }
  if (q.search) {
    const rx = new RegExp(String(q.search).trim().slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ code: rx }, { title: rx }];
  }
  const pg = pageParams(q);
  const [rows, total, cost] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('vendor', 'name kind').populate('packages', 'title'),
    Coupon.countDocuments(filter),
    // What Plejar's coupons have cost so far (uses still counted)
    CouponRedemption.aggregate([{ $match: { status: 'applied' } }, { $group: { _id: '$fundedBy', uses: { $sum: 1 }, discount: { $sum: '$discount' } } }])
  ]);
  const totals = Object.fromEntries(cost.map(c => [c._id, { uses: c.uses, discount: c.discount }]));
  res.status(200).json({ status: 'success', data: { coupons: await withUsage(rows), totals: { plejar: totals.plejar || { uses: 0, discount: 0 }, vendor: totals.vendor || { uses: 0, discount: 0 } }, ...paged(total, pg) } });
});

const findAny = async id => {
  const coupon = validId(id) ? await Coupon.findById(id) : null;
  if (!coupon) throw new AppError('No coupon found with that ID.', 404);
  return coupon;
};

exports.adminCreate = catchAsync(async (req, res) => {
  const fields = await readInput(req.body || {}, null);
  let coupon;
  try {
    coupon = await Coupon.create({ ...fields, fundedBy: 'plejar', createdBy: req.user._id });
  } catch (err) { throw saveError(err); }
  await logActivity(req, { action: 'coupon.created', summary: `Made Plejar coupon ${coupon.code} (${offerLabel(coupon)})` });
  res.status(201).json({ status: 'success', message: `${coupon.code} is ${coupon.status === 'active' ? 'live' : 'saved, paused'}. Plejar pays its discounts.`, data: { coupon: (await withUsage([coupon]))[0] } });
});

// Plejar's coupons can be edited; a vendor's can only be blocked or allowed again
exports.adminUpdate = catchAsync(async (req, res) => {
  const coupon = await findAny(req.params.id);
  const b = req.body || {};
  if (b.blocked !== undefined) {
    if (coupon.fundedBy !== 'vendor') throw new AppError("Pause Plejar's own coupons instead.", 400);
    coupon.blockedByAdmin = b.blocked === true || b.blocked === 'true';
    coupon.blockedReason = coupon.blockedByAdmin ? text(b.reason, 300) : '';
    if (coupon.blockedByAdmin && !coupon.blockedReason) throw new AppError('Say why the coupon is stopped; the vendor sees it.', 400);
    await coupon.save();
    await logActivity(req, { action: coupon.blockedByAdmin ? 'coupon.blocked' : 'coupon.allowed', summary: `${coupon.blockedByAdmin ? 'Stopped' : 'Allowed again'} coupon ${coupon.code}`, agency: coupon.vendor });
  } else {
    if (coupon.fundedBy !== 'plejar') throw new AppError("A vendor's coupon is edited by the vendor. You can stop it.", 400);
    await applyEdit(coupon, await readInput(b, null, coupon.vendor));
  }
  await coupon.populate('vendor', 'name kind');
  res.status(200).json({ status: 'success', data: { coupon: (await withUsage([coupon]))[0] } });
});

exports.adminDelete = catchAsync(async (req, res) => {
  const coupon = await findAny(req.params.id);
  if (coupon.fundedBy !== 'plejar') throw new AppError("A vendor's coupon can only be stopped here.", 400);
  if (await CouponRedemption.exists({ coupon: coupon._id })) throw new AppError('This coupon has been used, so it stays in the history. Pause it instead.', 400);
  await Coupon.deleteOne({ _id: coupon._id });
  res.status(204).json({});
});

// GET /admin/coupons/:id/redemptions — who used it, on what, and for how much
exports.adminRedemptions = catchAsync(async (req, res) => {
  const coupon = await findAny(req.params.id);
  const pg = pageParams(req.query);
  const filter = { coupon: coupon._id };
  const [rows, total] = await Promise.all([
    CouponRedemption.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit)
      .populate('user', 'name email').populate('vendor', 'name').populate('booking', 'reference packageTitle status').populate('stayRequest', 'roomName status checkIn').lean(),
    CouponRedemption.countDocuments(filter)
  ]);
  res.status(200).json({ status: 'success', data: { redemptions: rows, ...paged(total, pg) } });
});
