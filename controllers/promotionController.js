const mongoose = require('mongoose');
const Promotion = require('../models/promotionModel');
const Package = require('../models/packageModel');
const Destination = require('../models/destinationModel');
const Agency = require('../models/agencyModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { saveContentImage, removeContentImage, removeContentFolder } = require('../utils/uploads');

// Banners on the app's Tours screen ("Summer Adventure Sale"), managed in the admin panel

const validId = id => mongoose.isValidObjectId(id);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

const bannerView = p => ({
  _id: p._id,
  title: p.title,
  subtitle: p.subtitle,
  highlight: p.highlight,
  ctaLabel: p.ctaLabel || 'Explore Now',
  image: p.image,
  target: p.target,
  // Open GET /tours with these to show the offer's tours
  params: { promotion: String(p._id) },
  endsAt: p.endsAt || null
});

// GET /promotions — live banners, in the admin's order
exports.listLive = catchAsync(async (req, res) => {
  const rows = await Promotion.find(Promotion.liveFilter()).sort({ order: 1, createdAt: -1 }).limit(10).lean();
  res.status(200).json({ status: 'success', data: { banners: rows.map(bannerView) } });
});

// ---------- Admin ----------

const date = (v, label) => {
  if (v === '' || v === null || v === undefined) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new AppError(`Enter a valid ${label}.`, 400);
  return d;
};

const applyForm = async (promo, b) => {
  if (b.title !== undefined) promo.title = text(b.title, 60);
  if (b.subtitle !== undefined) promo.subtitle = text(b.subtitle, 100);
  if (b.highlight !== undefined) promo.highlight = text(b.highlight, 30);
  if (b.ctaLabel !== undefined) promo.ctaLabel = text(b.ctaLabel, 24) || 'Explore Now';
  if (b.target !== undefined) {
    if (!Promotion.TARGETS.includes(b.target)) throw new AppError('Choose what the banner opens.', 400);
    promo.target = b.target;
  }
  if (b.tours !== undefined) {
    const ids = [].concat(b.tours).flatMap(v => String(v).split(',')).map(s => s.trim()).filter(validId);
    const found = await Package.find({ _id: { $in: ids } }).select('_id').lean();
    promo.tours = found.map(t => t._id);
  }
  if (b.destination !== undefined) {
    if (b.destination && (!validId(b.destination) || !(await Destination.exists({ _id: b.destination })))) throw new AppError('Choose a destination from the list.', 400);
    promo.destination = b.destination || undefined;
  }
  if (b.agency !== undefined) {
    if (b.agency && (!validId(b.agency) || !(await Agency.exists({ _id: b.agency })))) throw new AppError('Choose a vendor from the list.', 400);
    promo.agency = b.agency || undefined;
  }
  if (b.tourType !== undefined) {
    if (b.tourType && !Package.TOUR_TYPES.includes(b.tourType)) throw new AppError('Choose a tour type.', 400);
    promo.tourType = b.tourType || '';
  }
  if (b.minDiscount !== undefined) {
    const n = b.minDiscount === '' ? 0 : Number(b.minDiscount);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError('Minimum discount is 0 to 100 percent.', 400);
    promo.minDiscount = n;
  }
  if (b.startsAt !== undefined) promo.startsAt = date(b.startsAt, 'start date');
  if (b.endsAt !== undefined) promo.endsAt = date(b.endsAt, 'end date');
  if (promo.startsAt && promo.endsAt && promo.endsAt < promo.startsAt) throw new AppError('The banner cannot end before it starts.', 400);
  if (b.active !== undefined) promo.active = b.active === true || b.active === 'true';
  if (b.order !== undefined) promo.order = Number(b.order) || 0;

  // Each target needs its matching choice
  const need = { tours: [promo.tours && promo.tours.length, 'choose at least one tour'], destination: [promo.destination, 'choose the destination'], agency: [promo.agency, 'choose the vendor'], tour_type: [promo.tourType, 'choose the tour type'] }[promo.target];
  if (need && !need[0]) throw new AppError(`For this banner, ${need[1]}.`, 400);
};

const promoState = (p, now) => {
  if (!p.active) return 'off';
  if (p.startsAt && p.startsAt > now) return 'scheduled';
  if (p.endsAt && p.endsAt < now) return 'ended';
  return 'live';
};

const adminView = async p => {
  const now = new Date();
  const live = p.active && (!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt >= now);
  return {
    ...bannerView(p),
    active: p.active,
    live,
    state: promoState(p, now),
    startsAt: p.startsAt || null,
    tours: p.tours || [],
    destination: p.destination || null,
    agency: p.agency || null,
    tourType: p.tourType,
    minDiscount: p.minDiscount,
    order: p.order,
    clicks: p.clicks,
    updatedAt: p.updatedAt
  };
};

exports.adminList = catchAsync(async (req, res) => {
  const rows = await Promotion.find().sort({ order: 1, createdAt: -1 }).populate('destination', 'name').populate('agency', 'name').populate('tours', 'title').lean();
  res.status(200).json({ status: 'success', data: { promotions: await Promise.all(rows.map(adminView)), targets: Promotion.TARGETS, tourTypes: Package.TOUR_TYPES } });
});

exports.adminCreate = catchAsync(async (req, res) => {
  const promo = new Promotion({ createdBy: req.user._id });
  await applyForm(promo, req.body);
  await promo.validate();
  if (req.file) promo.image = await saveContentImage(req.file, 'promotions', promo._id, { width: 1600 });
  await promo.save();
  await logActivity(req, { action: 'promotion.created', summary: `Banner added: ${promo.title}` });
  res.status(201).json({ status: 'success', data: { promotion: await adminView(promo.toObject()) } });
});

exports.adminUpdate = catchAsync(async (req, res, next) => {
  const promo = validId(req.params.id) ? await Promotion.findById(req.params.id) : null;
  if (!promo) return next(new AppError('No banner found with that ID.', 404));
  await applyForm(promo, req.body);
  if (req.file) {
    const old = promo.image;
    promo.image = await saveContentImage(req.file, 'promotions', promo._id, { width: 1600 });
    await removeContentImage(old);
  }
  await promo.save();
  await logActivity(req, { action: 'promotion.updated', summary: `Banner updated: ${promo.title}` });
  res.status(200).json({ status: 'success', data: { promotion: await adminView(promo.toObject()) } });
});

exports.adminDelete = catchAsync(async (req, res, next) => {
  const promo = validId(req.params.id) ? await Promotion.findById(req.params.id) : null;
  if (!promo) return next(new AppError('No banner found with that ID.', 404));
  await removeContentFolder('promotions', promo._id);
  await promo.deleteOne();
  await logActivity(req, { action: 'promotion.deleted', summary: `Banner deleted: ${promo.title}` });
  res.status(204).json({ status: 'success', data: null });
});

exports.bannerView = bannerView;
