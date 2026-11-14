const mongoose = require('mongoose');
const Promotion = require('../models/promotionModel');
const Package = require('../models/packageModel');
const Destination = require('../models/destinationModel');
const Agency = require('../models/agencyModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { saveContentImage, removeContentImage, removeContentFolder } = require('../utils/uploads');
const { priceView } = require('../utils/tourCards');
const { viewerDistrict, sliderFor, allAdsPage, newSeed } = require('../utils/adRanking');

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
  // A vendor's ad is for one tour: open GET /tours/:tourId?promotion=<id> straight away
  sponsored: p.source === 'vendor',
  tourId: p.source === 'vendor' && p.tour ? p.tour : null,
  endsAt: p.endsAt || null
});

/**
 * The slider for a request: Plejar's banners first, then agents' ads nearest the traveler, taking
 * turns (utils/adRanking.js). An ad only shows while its tour is published and its agency active.
 * Returns { banners, adsTotal }; with `count`, each ad shown counts a view.
 */
const liveBanners = async (req, { count = false } = {}) => {
  const viewer = viewerDistrict({ lat: req.query.lat, lng: req.query.lng, districtCode: req.query.district, user: req.user });
  const { slides, adsTotal } = await sliderFor(viewer, { count });
  return { banners: slides, adsTotal };
};
exports.liveBanners = liveBanners;

// GET /promotions?lat&lng&district — the slider. Cached for a minute, so it doesn't count views.
exports.listLive = catchAsync(async (req, res) => {
  const { banners, adsTotal } = await liveBanners(req);
  res.status(200).json({ status: 'success', data: { banners: banners.map(bannerView), adsTotal } });
});

// One ad on the "See all" screen: the slide, plus the tour it is for
const adListView = p => {
  const t = p.tourDoc;
  return {
    ...bannerView(p),
    nearness: p.nearness,
    tour: {
      _id: t._id,
      title: t.title,
      photo: (t.photos || [])[0] || '',
      location: t.destination || '',
      startDate: t.startDate || null,
      endDate: t.endDate || null,
      startsFrom: p.start ? { code: p.start.code, name: p.start.name, nameBn: p.start.nameBn } : null,
      price: priceView(t.priceFrom, t.regularPrice),
      agency: { _id: t.agency._id, name: t.agency.name, logo: t.agency.logo || '', verified: Boolean(t.agency.verified) }
    }
  };
};

/**
 * GET /promotions/ads?lat&lng&district&seed&page&limit — every live agent's ad, nearest first, for the
 * "See all" screen. The first page returns a `seed`; send it back with the next pages so the order
 * stays the same while the traveler scrolls.
 */
exports.listAds = catchAsync(async (req, res) => {
  const viewer = viewerDistrict({ lat: req.query.lat, lng: req.query.lng, districtCode: req.query.district, user: req.user });
  const seed = /^[a-f0-9]{6,32}$/.test(String(req.query.seed || '')) ? String(req.query.seed) : newSeed();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 30);
  const { rows, total } = await allAdsPage(viewer, { seed, page, limit });
  res.status(200).json({
    status: 'success',
    data: {
      ads: rows.map(adListView),
      seed,
      district: viewer ? { code: viewer.code, name: viewer.name, nameBn: viewer.nameBn } : null,
      page,
      limit,
      total,
      hasMore: page * limit < total
    }
  });
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
  // A vendor's ad belongs to its agency; the banner form only sends a vendor for "A vendor's tours"
  if (b.agency !== undefined && promo.source !== 'vendor') {
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
    source: p.source || 'admin',
    order: p.order,
    clicks: p.clicks,
    views: p.views || 0,
    updatedAt: p.updatedAt
  };
};

exports.adminList = catchAsync(async (req, res) => {
  // Vendor ads join this list once accepted; until then they wait under Ad requests
  const rows = await Promotion.find({ $or: [{ source: { $ne: 'vendor' } }, { reviewStatus: 'approved' }] }).sort({ order: 1, createdAt: -1 }).populate('destination', 'name').populate('agency', 'name').populate('tours', 'title').lean();
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
