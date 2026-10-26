const mongoose = require('mongoose');
const { Voucher, UserVoucher } = require('../models/voucherModel');
const PointsEntry = require('../models/pointsModel');
const Destination = require('../models/destinationModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { saveContentImage, removeContentImage, removeContentFolder } = require('../utils/uploads');
const { pointsSummary, pointsPerTaka } = require('../utils/rewards');
const { referralReward } = require('../utils/referrals');
const { CATEGORY_LABELS, discountLabel, voucherCard, redeemProblem, expiryFor, personalCode, expireOld, isOver, soldOut, discountFor } = require('../utils/vouchers');

// Vouchers & Rewards in the app (/api/v1/vouchers) and the admin's voucher list

const validId = id => mongoose.isValidObjectId(id);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

const POINT_RANGES = [
  { key: '0-1000', label: '0 - 1000', min: 0, max: 1000 },
  { key: '1001-2000', label: '1001 - 2000', min: 1001, max: 2000 },
  { key: '2001-3000', label: '2001 - 3000', min: 2001, max: 3000 },
  { key: '3001+', label: '3001+', min: 3001, max: null }
];
const SORTS = [
  { key: 'popular', label: 'Most popular' },
  { key: 'newest', label: 'Newest' },
  { key: 'points_low', label: 'Points: low to high' },
  { key: 'points_high', label: 'Points: high to low' },
  { key: 'ending_soon', label: 'Ending soon' }
];
const SORT_BY = {
  popular: { redeemedCount: -1, createdAt: -1 },
  newest: { createdAt: -1 },
  points_low: { pointsCost: 1, createdAt: -1 },
  points_high: { pointsCost: -1, createdAt: -1 },
  ending_soon: { usableUntil: 1, createdAt: -1 }
};
// The filter panel shows these; the rest still work with ?category=
const FILTER_CATEGORIES = ['hotel', 'flight', 'airport', 'tour'];

const list = v => [].concat(v || []).flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean);

// Offers a traveler can redeem now
const offeredFilter = () => ({
  active: true,
  $and: [
    { $or: [{ usableUntil: null }, { usableUntil: { $gte: new Date(Date.now() - 86400000) } }] },
    { $or: [{ stock: null }, { $expr: { $lt: ['$redeemedCount', '$stock'] } }] }
  ]
});

// ?category=hotel,tour&points=0-1000,3001+ as a Voucher filter
const readFilters = q => {
  const filter = {};
  const categories = list(q.category).filter(c => Voucher.CATEGORIES.includes(c));
  if (categories.length) filter.category = { $in: categories };
  const ranges = POINT_RANGES.filter(r => list(q.points).includes(r.key));
  if (ranges.length) filter.$or = ranges.map(r => ({ pointsCost: r.max === null ? { $gte: r.min } : { $gte: r.min, $lte: r.max } }));
  return { filter, categories, ranges: ranges.map(r => r.key) };
};

const myRedemptions = async (userId, voucherIds) => {
  const rows = await UserVoucher.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(userId)), voucher: { $in: voucherIds } } },
    { $group: { _id: '$voucher', n: { $sum: 1 } } }
  ]);
  return new Map(rows.map(r => [String(r._id), r.n]));
};

// A redeemed voucher on the Redeemed / Expired tabs
const ownedCard = (uv, balance) => ({
  ...voucherCard(uv.voucher, { balance }),
  myVoucher: {
    _id: uv._id,
    code: uv.code,
    status: uv.status,
    pointsSpent: uv.pointsSpent,
    redeemedAt: uv.createdAt,
    expiresAt: uv.expiresAt || null,
    usedAt: uv.usedAt || null,
    booking: uv.booking || null,
    discountGiven: uv.discountGiven || 0
  }
});

/**
 * GET /vouchers?tab=available|redeemed|expired&category=hotel,tour&points=0-1000,3001+&sort=&page
 * One call for the whole screen: points balance, tab counts, filter options and the cards.
 */
exports.listVouchers = catchAsync(async (req, res) => {
  const userId = req.user._id;
  await expireOld(userId);
  const tab = ['available', 'redeemed', 'expired'].includes(req.query.tab) ? req.query.tab : 'available';
  const sort = SORT_BY[req.query.sort] ? req.query.sort : 'popular';
  const { filter, categories, ranges } = readFilters(req.query);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const { balance, earned } = await pointsSummary(userId);
  const [available, redeemed, expired] = await Promise.all([
    Voucher.countDocuments(offeredFilter()),
    UserVoucher.countDocuments({ user: userId, status: { $in: ['active', 'used'] } }),
    UserVoucher.countDocuments({ user: userId, status: 'expired' })
  ]);

  let cards;
  let total;
  if (tab === 'available') {
    const match = { $and: [offeredFilter(), filter] };
    const [rows, n] = await Promise.all([
      Voucher.find(match).sort(SORT_BY[sort]).skip((page - 1) * limit).limit(limit).lean(),
      Voucher.countDocuments(match)
    ]);
    const mine = await myRedemptions(userId, rows.map(v => v._id));
    cards = rows.map(v => voucherCard(v, { balance, mine: mine.get(String(v._id)) || 0 }));
    total = n;
  } else {
    // Redeemed and expired vouchers, filtered by the offer they came from
    const voucherIds = Object.keys(filter).length ? (await Voucher.find(filter).select('_id').lean()).map(v => v._id) : null;
    const match = { user: userId, status: tab === 'redeemed' ? { $in: ['active', 'used'] } : 'expired', ...(voucherIds ? { voucher: { $in: voucherIds } } : {}) };
    const [rows, n] = await Promise.all([
      UserVoucher.find(match).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('voucher').lean(),
      UserVoucher.countDocuments(match)
    ]);
    cards = rows.filter(r => r.voucher).map(r => ownedCard(r, balance));
    total = n;
  }

  res.status(200).json({
    status: 'success',
    results: cards.length,
    data: {
      points: { balance, totalEarned: earned },
      tab,
      counts: { available, redeemed, expired },
      filters: {
        categories: FILTER_CATEGORIES.map(key => ({ key, label: CATEGORY_LABELS[key] })),
        pointRanges: POINT_RANGES.map(({ key, label }) => ({ key, label })),
        sorts: SORTS,
        selected: { category: categories, points: ranges, sort }
      },
      vouchers: cards,
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1)
    }
  });
});

// Ways to earn points, shown under "Earn More Points"
const earnWays = async () => {
  const [perTaka, perReferral] = await Promise.all([pointsPerTaka(), referralReward()]);
  return [
    { key: 'book', title: 'Book a trip', text: `Earn ${perTaka} point${perTaka === 1 ? '' : 's'} for every ৳1 you spend on completed tours, hotels and guides.`, action: 'tours' },
    { key: 'refer', title: 'Refer friends', text: `Get ${perReferral.toLocaleString('en-US')} points when a friend you invite completes their first trip.`, action: 'refer_friends' },
    { key: 'review', title: 'Share your trips', text: 'Leave reviews and post about your travels to unlock achievements.', action: 'travel_history' }
  ];
};

const loadVoucher = async (id, next) => {
  const v = validId(id) ? await Voucher.findById(id).lean() : null;
  if (!v || (!v.active && !(await UserVoucher.exists({ voucher: v._id })))) {
    next(new AppError('No voucher found with that ID.', 404));
    return null;
  }
  return v;
};

/** GET /vouchers/:id — details, the traveler's own codes for it, similar vouchers, ways to earn */
exports.getVoucher = catchAsync(async (req, res, next) => {
  const v = await loadVoucher(req.params.id, next);
  if (!v) return;
  await expireOld(req.user._id);
  const [{ balance }, mineRows, similarRows, ways] = await Promise.all([
    pointsSummary(req.user._id),
    UserVoucher.find({ user: req.user._id, voucher: v._id }).sort({ createdAt: -1 }).lean(),
    Voucher.find({ ...offeredFilter(), _id: { $ne: v._id }, category: v.category }).sort(SORT_BY.popular).limit(6).lean(),
    earnWays()
  ]);
  // Not enough of the same kind: fill up with other popular ones
  let similar = similarRows;
  if (similar.length < 4) {
    similar = similar.concat(await Voucher.find({ ...offeredFilter(), _id: { $nin: [v._id, ...similar.map(s => s._id)] } }).sort(SORT_BY.popular).limit(4 - similar.length).lean());
  }
  const problem = redeemProblem(v, { balance, mine: mineRows.length });
  res.status(200).json({
    status: 'success',
    data: {
      voucher: {
        ...voucherCard(v, { balance, mine: mineRows.length }),
        code: v.code || null,
        terms: v.terms,
        perUserLimit: v.perUserLimit,
        validDays: v.validDays
      },
      points: { balance },
      canRedeem: !problem,
      problem,
      myVouchers: mineRows.map(uv => ({ _id: uv._id, code: uv.code, status: uv.status, redeemedAt: uv.createdAt, expiresAt: uv.expiresAt || null, usedAt: uv.usedAt || null })),
      similar: similar.map(s => voucherCard(s, { balance })),
      earnMorePoints: ways
    }
  });
});

/** POST /vouchers/lookup { code } — step 1 of "Redeem": find the offer by its code */
exports.lookupCode = catchAsync(async (req, res) => {
  const code = text(req.body.code, 40).toUpperCase();
  if (!code) return res.status(400).json({ status: 'fail', message: 'Enter the voucher code.', errors: { code: 'Enter the voucher code.' } });
  const v = await Voucher.findOne({ code, active: true }).lean();
  if (!v || isOver(v)) return res.status(404).json({ status: 'fail', message: "This voucher code doesn't exist or has ended.", errors: { code: "This voucher code doesn't exist or has ended." } });
  const { balance } = await pointsSummary(req.user._id);
  const mine = await UserVoucher.countDocuments({ user: req.user._id, voucher: v._id });
  res.status(200).json({ status: 'success', data: { voucher: voucherCard(v, { balance, mine }), canRedeem: !redeemProblem(v, { balance, mine }), problem: redeemProblem(v, { balance, mine }) } });
});

// What step 2 ("Confirm Details") shows
const preview = async (v, userId) => {
  const { balance } = await pointsSummary(userId);
  const mine = await UserVoucher.countDocuments({ user: userId, voucher: v._id });
  const problem = redeemProblem(v, { balance, mine });
  return {
    voucherId: v._id,
    title: v.title,
    code: v.code || null,
    type: CATEGORY_LABELS[v.category] || v.category,
    discount: discountLabel(v.discount),
    validUntil: expiryFor(v),
    pointsRequired: v.pointsCost,
    balance,
    balanceAfter: balance - v.pointsCost,
    canRedeem: !problem,
    problem
  };
};

// GET /vouchers/:id/redeem — the confirmation before points are spent
exports.redeemPreview = catchAsync(async (req, res, next) => {
  const v = await loadVoucher(req.params.id, next);
  if (!v) return;
  res.status(200).json({ status: 'success', data: { confirm: await preview(v, req.user._id) } });
});

/**
 * POST /vouchers/:id/redeem — spend the points and get a personal code (step 3, "Complete").
 * The stock is taken first and given back if anything after fails.
 */
// Spend the points and create the traveler's personal code. Throws AppError. Returns the 201 body.
const redeemVoucher = async (v, user) => {
  const check = await preview(v, user._id);
  if (!check.canRedeem) throw new AppError(check.problem, 400);

  const taken = await Voucher.findOneAndUpdate(
    { _id: v._id, active: true, $or: [{ stock: null }, { $expr: { $lt: ['$redeemedCount', '$stock'] } }] },
    { $inc: { redeemedCount: 1 } },
    { new: true }
  );
  if (!taken) throw new AppError('This voucher is sold out.', 400);

  let uv;
  let entry;
  try {
    uv = await UserVoucher.create({ user: user._id, voucher: v._id, code: await personalCode(v), pointsSpent: v.pointsCost, expiresAt: expiryFor(v) });
    // Free promo codes cost no points, so there's nothing to take away
    if (v.pointsCost > 0) entry = await PointsEntry.create({ user: user._id, points: -v.pointsCost, kind: 'redeemed', reason: `Redeemed ${v.title}`, voucher: uv._id });
    // Two redemptions at the same moment could both pass the balance check: undo this one if so
    const [sum, count] = await Promise.all([
      PointsEntry.aggregate([{ $match: { user: user._id } }, { $group: { _id: null, n: { $sum: '$points' } } }]),
      UserVoucher.countDocuments({ user: user._id, voucher: v._id })
    ]);
    if (count > (v.perUserLimit || 1)) throw new AppError('You already redeemed this voucher.', 400);
    if (sum[0] && sum[0].n < 0) throw new AppError("You don't have enough points for this voucher.", 400);
  } catch (err) {
    await Promise.all([
      Voucher.updateOne({ _id: v._id }, { $inc: { redeemedCount: -1 } }),
      uv ? UserVoucher.deleteOne({ _id: uv._id }) : null,
      entry ? PointsEntry.deleteOne({ _id: entry._id }) : null
    ]);
    throw err;
  }

  const { balance } = await pointsSummary(user._id);
  return {
    complete: {
      code: uv.code,
      title: v.title,
      redeemedAt: uv.createdAt,
      pointsUsed: v.pointsCost,
      balance,
      expiresAt: uv.expiresAt,
      usableOnBookings: Voucher.BOOKABLE.includes(v.category)
    },
    myVoucher: ownedCard({ ...uv.toObject(), voucher: taken.toObject() }, balance)
  };
};

/**
 * POST /vouchers/:id/redeem — spend the points and get a personal code (step 3, "Complete").
 * The stock is taken first and given back if anything after fails.
 */
exports.redeem = catchAsync(async (req, res, next) => {
  const v = await loadVoucher(req.params.id, next);
  if (!v) return;
  res.status(201).json({ status: 'success', message: 'Voucher redeemed.', data: await redeemVoucher(v, req.user) });
});

/**
 * POST /vouchers/apply-code { code, confirm } — "Have a promo code? APPLY" on the Account screen.
 * A free code is added straight away. One that costs points first answers with what it costs
 * (needsConfirm); send it again with confirm: true to spend them.
 */
exports.applyCode = catchAsync(async (req, res) => {
  const code = text(req.body.code, 40).toUpperCase();
  const fail = message => res.status(400).json({ status: 'fail', message, errors: { code: message } });
  if (!code) return fail('Enter a promo code.');
  const v = await Voucher.findOne({ code, active: true }).lean();
  if (!v || isOver(v)) return fail("This promo code doesn't exist or has ended.");
  const check = await preview(v, req.user._id);
  if (!check.canRedeem) return fail(check.problem);
  if (v.pointsCost > 0 && !(req.body.confirm === true || req.body.confirm === 'true')) {
    return res.status(200).json({ status: 'success', message: `This voucher costs ${v.pointsCost.toLocaleString('en-US')} points.`, data: { needsConfirm: true, confirm: check } });
  }
  res.status(201).json({ status: 'success', message: `Promo code applied: ${v.title}.`, data: { needsConfirm: false, ...(await redeemVoucher(v, req.user)) } });
});

/**
 * GET /vouchers/usable?kind=tour|hotel|guide&amount= — the traveler's unused vouchers that fit a
 * booking (for the "Apply voucher" picker on the booking screen), with the taka each would take off.
 */
exports.usableVouchers = catchAsync(async (req, res) => {
  await expireOld(req.user._id);
  const kind = Voucher.BOOKABLE.includes(req.query.kind) ? req.query.kind : null;
  const amount = Math.max(Number(req.query.amount) || 0, 0);
  const rows = await UserVoucher.find({ user: req.user._id, status: 'active' }).sort({ expiresAt: 1 }).populate('voucher').lean();
  const fits = rows.filter(r => r.voucher && Voucher.BOOKABLE.includes(r.voucher.category) && (!kind || r.voucher.category === kind));
  res.status(200).json({
    status: 'success',
    data: {
      vouchers: fits.map(r => {
        const short = r.voucher.minSpend && amount && amount < r.voucher.minSpend;
        return {
          code: r.code,
          title: r.voucher.title,
          badge: discountLabel(r.voucher.discount),
          category: r.voucher.category,
          expiresAt: r.expiresAt || null,
          minSpend: r.voucher.minSpend || 0,
          applicable: !short && !(r.voucher.usableFrom && new Date(r.voucher.usableFrom) > new Date()),
          discount: amount && !short ? discountFor(r.voucher, amount) : null
        };
      })
    }
  });
});

// ---------- Admin ----------

const date = (v, label) => {
  if (v === '' || v === null || v === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(v))) throw new AppError(`Enter the ${label} as YYYY-MM-DD.`, 400);
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new AppError(`Enter a valid ${label}.`, 400);
  return d;
};

const number = (v, label, { min = 0, max = Infinity, empty = 0 } = {}) => {
  if (v === '' || v === null || v === undefined) return empty;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new AppError(`${label} should be a number from ${min}${max === Infinity ? ' up' : ` to ${max}`}.`, 400);
  return n;
};

const applyForm = async (v, b) => {
  if (b.title !== undefined) v.title = text(b.title, 80);
  if (b.description !== undefined) v.description = text(b.description, 2000);
  if (b.category !== undefined) {
    if (!Voucher.CATEGORIES.includes(b.category)) throw new AppError('Choose a category.', 400);
    v.category = b.category;
  }
  const d = typeof b.discount === 'object' && b.discount ? b.discount : { type: b.discountType, value: b.discountValue, maxAmount: b.discountMax };
  if (d.type !== undefined) {
    if (!['percent', 'amount', 'free'].includes(d.type)) throw new AppError('Choose what the voucher gives: percent off, amount off or free.', 400);
    v.discount.type = d.type;
  }
  if (d.value !== undefined) v.discount.value = number(d.value, 'The discount', { max: v.discount.type === 'percent' ? 100 : 10000000 });
  if (d.maxAmount !== undefined) v.discount.maxAmount = number(d.maxAmount, 'The discount cap', { empty: null });
  if (v.discount.type === 'percent' && !(v.discount.value > 0)) throw new AppError('Enter the percent off (1 to 100).', 400);
  if (v.discount.type === 'amount' && !(v.discount.value > 0)) throw new AppError('Enter the taka off.', 400);
  if (b.pointsCost !== undefined) v.pointsCost = number(b.pointsCost, 'Points', { max: 10000000 });
  if (b.code !== undefined) {
    const code = text(b.code, 30).toUpperCase();
    if (code && !/^[A-Z0-9-]{3,30}$/.test(code)) throw new AppError('Use 3 to 30 letters, digits or hyphens for the code.', 400);
    if (code && await Voucher.exists({ code, _id: { $ne: v._id } })) throw new AppError('Another voucher already uses this code.', 400);
    v.code = code || undefined;
  }
  if (b.destination !== undefined) {
    if (b.destination && (!validId(b.destination) || !(await Destination.exists({ _id: b.destination })))) throw new AppError('Choose a destination from the list.', 400);
    v.destination = b.destination || undefined;
  }
  if (b.locationLabel !== undefined) v.locationLabel = text(b.locationLabel, 120);
  if (b.usableFrom !== undefined) v.usableFrom = date(b.usableFrom, 'start date');
  if (b.usableUntil !== undefined) v.usableUntil = date(b.usableUntil, 'end date');
  if (v.usableFrom && v.usableUntil && v.usableUntil < v.usableFrom) throw new AppError('The voucher cannot end before it starts.', 400);
  if (b.validDays !== undefined) v.validDays = number(b.validDays, 'Valid days', { min: 1, max: 730, empty: 90 });
  if (b.minSpend !== undefined) v.minSpend = number(b.minSpend, 'Minimum spend');
  if (b.terms !== undefined) v.terms = (Array.isArray(b.terms) ? b.terms : String(b.terms).split('\n')).map(t => text(t, 300)).filter(Boolean).slice(0, 20);
  if (b.stock !== undefined) v.stock = number(b.stock, 'Stock', { empty: null });
  if (b.perUserLimit !== undefined) v.perUserLimit = number(b.perUserLimit, 'Per-traveler limit', { min: 1, max: 100, empty: 1 });
  if (b.active !== undefined) v.active = b.active === true || b.active === 'true';
};

const voucherState = v => {
  if (!v.active) return 'off';
  if (isOver(v)) return 'ended';
  if (soldOut(v)) return 'sold_out';
  return 'live';
};

const adminView = v => ({
  ...voucherCard(v),
  code: v.code || '',
  destination: v.destination || null,
  validDays: v.validDays,
  terms: v.terms,
  stock: v.stock,
  perUserLimit: v.perUserLimit,
  redeemedCount: v.redeemedCount,
  active: v.active,
  state: voucherState(v),
  updatedAt: v.updatedAt
});

exports.adminList = catchAsync(async (req, res) => {
  const filter = {};
  if (Voucher.CATEGORIES.includes(req.query.category)) filter.category = req.query.category;
  const rows = await Voucher.find(filter).sort({ createdAt: -1 }).populate('destination', 'name').lean();
  const used = await UserVoucher.aggregate([{ $match: { status: 'used' } }, { $group: { _id: '$voucher', n: { $sum: 1 }, discount: { $sum: '$discountGiven' } } }]);
  const usedBy = new Map(used.map(u => [String(u._id), u]));
  res.status(200).json({
    status: 'success',
    data: {
      vouchers: rows.map(v => ({ ...adminView(v), usedCount: (usedBy.get(String(v._id)) || {}).n || 0, discountGiven: (usedBy.get(String(v._id)) || {}).discount || 0 })),
      categories: Voucher.CATEGORIES.map(key => ({ key, label: CATEGORY_LABELS[key] })),
      bookable: Voucher.BOOKABLE
    }
  });
});

exports.adminCreate = catchAsync(async (req, res) => {
  const v = new Voucher({ createdBy: req.user._id });
  await applyForm(v, req.body);
  await v.validate();
  if (req.file) v.image = await saveContentImage(req.file, 'vouchers', v._id, { width: 1200 });
  await v.save();
  await logActivity(req, { action: 'voucher.created', summary: `Voucher added: ${v.title} (${v.pointsCost} points)` });
  res.status(201).json({ status: 'success', data: { voucher: adminView(v.toObject()) } });
});

exports.adminUpdate = catchAsync(async (req, res, next) => {
  const v = validId(req.params.id) ? await Voucher.findById(req.params.id) : null;
  if (!v) return next(new AppError('No voucher found with that ID.', 404));
  await applyForm(v, req.body);
  if (req.file) {
    const old = v.image;
    v.image = await saveContentImage(req.file, 'vouchers', v._id, { width: 1200 });
    await removeContentImage(old);
  }
  await v.save();
  await logActivity(req, { action: 'voucher.updated', summary: `Voucher updated: ${v.title}` });
  res.status(200).json({ status: 'success', data: { voucher: adminView(v.toObject()) } });
});

// A voucher someone already redeemed is only switched off, so their code keeps working
exports.adminDelete = catchAsync(async (req, res, next) => {
  const v = validId(req.params.id) ? await Voucher.findById(req.params.id) : null;
  if (!v) return next(new AppError('No voucher found with that ID.', 404));
  if (await UserVoucher.exists({ voucher: v._id })) {
    v.active = false;
    await v.save();
    await logActivity(req, { action: 'voucher.disabled', summary: `Voucher switched off (already redeemed by travelers): ${v.title}` });
    return res.status(200).json({ status: 'success', message: 'Travelers already redeemed this voucher, so it was switched off instead of deleted.', data: { voucher: adminView(v.toObject()) } });
  }
  await Voucher.deleteOne({ _id: v._id });
  await removeContentFolder('vouchers', v._id);
  await logActivity(req, { action: 'voucher.deleted', summary: `Voucher deleted: ${v.title}` });
  res.status(204).json({ status: 'success', data: null });
});
