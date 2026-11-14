const mongoose = require('mongoose');
const Promotion = require('../models/promotionModel');
const Package = require('../models/packageModel');
const User = require('../models/userModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Email = require('../utils/email');
const { logActivity } = require('../utils/activity');
const { saveContentImage, removeContentImage, removeContentFolder } = require('../utils/uploads');
const { district } = require('../utils/places');
const adPayments = require('../utils/adPayments');

/**
 * Vendor ads on the app's Tours screen. A vendor applies with a tour, a picture and the wording,
 * pays for the days it runs when ads cost money (utils/adPayments.js), and a Plejar admin accepts
 * or rejects it. An accepted ad is an ordinary banner (a slide), so the
 * existing banner list and the app's slides need nothing special.
 */

const validId = id => mongoose.isValidObjectId(id);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const fieldErrors = (res, errors) => res.status(400).json({ status: 'fail', message: Object.values(errors)[0], errors });
// Vendors pick calendar days; Plejar's days run on Bangladesh time
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = day => new Date(`${day}T00:00:00+06:00`);
const dayEnd = day => new Date(`${day}T23:59:59+06:00`);
const isoDay = d => (d ? new Date(d).toISOString().slice(0, 10) : '');
const tourDay = tour => isoDay(tour.startDate);

// What the vendor (and the admin) sees about where an ad stands
const adState = (ad, now = new Date()) => {
  if (ad.reviewStatus === 'unpaid') return 'unpaid';
  if (ad.reviewStatus === 'pending') return 'pending';
  if (ad.reviewStatus === 'rejected') return 'rejected';
  if (ad.stoppedAt || !ad.active) return 'stopped';
  if (ad.startsAt && ad.startsAt > now) return 'scheduled';
  if (ad.endsAt && ad.endsAt < now) return 'ended';
  return 'live';
};

// What was paid for the ad, when its payment is loaded
const paymentSummary = p => (p && p.amount ? {
  amount: p.amount,
  days: p.days,
  method: p.method,
  status: p.status,
  trxId: p.trxId || '',
  paidAt: p.paidAt || null,
  flagged: Boolean(p.flagged),
  sandbox: Boolean(p.sandbox),
  refundRef: (p.refund && p.refund.ref) || ''
} : null);

const PAYMENT_FIELDS = 'amount days method status trxId paidAt flagged sandbox refund';

const adView = ad => ({
  _id: ad._id,
  title: ad.title,
  subtitle: ad.subtitle,
  highlight: ad.highlight,
  ctaLabel: ad.ctaLabel || 'Explore Now',
  image: ad.image,
  tour: ad.tour && ad.tour.title ? { _id: ad.tour._id, title: ad.tour.title, startDate: ad.tour.startDate, status: ad.tour.status } : ad.tour,
  startsAt: ad.startsAt || null,
  endsAt: ad.endsAt || null,
  state: adState(ad),
  rejectedReason: ad.reviewStatus === 'rejected' ? ad.rejectedReason : '',
  reviewedAt: ad.reviewedAt || null,
  clicks: ad.clicks || 0,
  views: ad.views || 0,
  payment: paymentSummary(ad.payment),
  createdAt: ad.createdAt
});

/**
 * Check the form. Sets the fields on `ad` and returns errors by field.
 * The ad runs from its start day (today by default) until the tour leaves at the latest.
 */
const applyAdForm = async (ad, b, agencyId) => {
  const errors = {};
  if (b.title !== undefined) ad.title = text(b.title, 60);
  if (b.subtitle !== undefined) ad.subtitle = text(b.subtitle, 100);
  if (b.highlight !== undefined) ad.highlight = text(b.highlight, 30);
  if (b.ctaLabel !== undefined) ad.ctaLabel = text(b.ctaLabel, 24) || 'Explore Now';
  if (!ad.title) errors.title = 'Give the ad a title.';
  if (ad.highlight && !ad.subtitle.includes(ad.highlight)) errors.highlight = 'The highlighted words must be part of the subtitle.';

  const tourId = b.tour !== undefined ? b.tour : ad.tour;
  const tour = validId(tourId) ? await Package.findOne({ _id: tourId, agency: agencyId }).select('title status startDate hiddenByAdmin startDistrict') : null;
  const today = isoDay(new Date(Date.now() + 6 * 3600 * 1000));
  if (!tour) errors.tour = 'Choose one of your tours.';
  else if (tour.status !== 'published' || tour.hiddenByAdmin) errors.tour = 'Only a published tour can be advertised.';
  else if (!tour.startDate || tourDay(tour) < today) errors.tour = 'This tour has already left.';
  // Ads are shown to travelers near where the tour starts
  else if (!district(tour.startDistrict)) errors.tour = 'Add the district this tour starts from (edit the tour, under Getting there) before applying for an ad.';
  if (errors.tour) return { errors, tour };
  ad.tour = tour._id;
  ad.tours = [tour._id];

  const from = b.startsAt !== undefined ? text(b.startsAt, 10) : isoDay(ad.startsAt && new Date(ad.startsAt.getTime() + 6 * 3600 * 1000));
  const until = b.endsAt !== undefined ? text(b.endsAt, 10) : isoDay(ad.endsAt && new Date(ad.endsAt.getTime() + 6 * 3600 * 1000));
  if (from && !DAY_RX.test(from)) errors.startsAt = 'Enter the start date as YYYY-MM-DD.';
  if (until && !DAY_RX.test(until)) errors.endsAt = 'Enter the end date as YYYY-MM-DD.';
  if (!errors.startsAt && from && from < today) errors.startsAt = "The ad can't start in the past.";
  if (!errors.endsAt && until && until > tourDay(tour)) errors.endsAt = 'The ad has to end by the day the tour leaves.';
  if (!errors.startsAt && !errors.endsAt && from && until && until < from) errors.endsAt = "The ad can't end before it starts.";
  if (!errors.startsAt) ad.startsAt = from ? dayStart(from) : undefined;
  if (!errors.endsAt) ad.endsAt = dayEnd(until || tourDay(tour));
  return { errors, tour };
};

// A tour has one ad at a time, unless the earlier one was rejected, stopped or has ended
const openAdFor = (tourId, exceptId) => Promotion.exists({
  source: 'vendor',
  tour: tourId,
  _id: { $ne: exceptId },
  $or: [{ reviewStatus: { $in: ['unpaid', 'pending'] } }, { reviewStatus: 'approved', active: true, $or: [{ endsAt: null }, { endsAt: { $gte: new Date() } }] }]
});

// ---------- Vendor ----------

// GET /agency/me/ads
exports.myAds = catchAsync(async (req, res) => {
  const [rows, pricing] = await Promise.all([
    Promotion.find({ source: 'vendor', agency: req.agency._id }).sort({ createdAt: -1 }).populate('tour', 'title startDate status').populate('payment', PAYMENT_FIELDS).lean(),
    adPayments.pricing()
  ]);
  // An unpaid ad shows what it would cost today
  const ads = await Promise.all(rows.map(async ad => (ad.reviewStatus === 'unpaid' ? { ...adView(ad), due: await adPayments.quote(ad) } : adView(ad))));
  res.status(200).json({ status: 'success', data: { ads, pricing } });
});

/**
 * POST /agency/me/ads (multipart: image) tour, title, subtitle, highlight, ctaLabel, startsAt, endsAt
 * When ads cost money the ad waits for payment (POST /agency/me/ads/:id/pay) and then for a Plejar
 * admin; nothing shows in the app before that.
 */
exports.applyForAd = catchAsync(async (req, res) => {
  const ad = new Promotion({ source: 'vendor', reviewStatus: 'pending', active: false, target: 'tours', agency: req.agency._id, createdBy: req.user._id });
  const { errors, tour } = await applyAdForm(ad, req.body, req.agency._id);
  if (!req.file) errors.image = 'Add a picture for the ad.';
  if (tour && !errors.tour && await openAdFor(tour._id, ad._id)) errors.tour = 'This tour already has an ad waiting for review or running.';
  if (Object.keys(errors).length) return fieldErrors(res, errors);
  await ad.validate();
  const due = await adPayments.quote(ad);
  if (due.amount) ad.reviewStatus = 'unpaid';
  ad.image = await saveContentImage(req.file, 'promotions', ad._id, { width: 1600 });
  await ad.save();
  await logActivity(req, { action: 'ad.requested', summary: `Applied for an ad: ${ad.title} (${tour.title})${due.amount ? `, ${due.amount} BDT to pay` : ''}`, agency: req.agency._id });
  res.status(201).json({
    status: 'success',
    message: due.amount ? `Your ad is saved. Pay ${due.amount} taka to send it for review.` : 'Your ad was sent for review. It shows in the app once Plejar accepts it.',
    data: { ad: { ...adView({ ...ad.toObject(), tour }), ...(due.amount ? { due } : {}) } }
  });
});

const findMyAd = async req => {
  const ad = validId(req.params.id) ? await Promotion.findOne({ _id: req.params.id, source: 'vendor', agency: req.agency._id }) : null;
  if (!ad) throw new AppError('No ad of yours with that ID.', 404);
  return ad;
};

// PATCH /agency/me/ads/:id — change an ad under review, or fix a rejected one and send it again
exports.updateMyAd = catchAsync(async (req, res, next) => {
  const ad = await findMyAd(req);
  if (ad.reviewStatus === 'approved') return next(new AppError("An accepted ad can't be changed. Stop it and apply again.", 400));
  const paidDates = ad.payment ? [ad.startsAt, ad.endsAt].map(d => (d ? d.getTime() : 0)).join() : null;
  const paidTour = ad.payment ? String(ad.tour) : null;
  const { errors, tour } = await applyAdForm(ad, req.body, req.agency._id);
  // The days and the tour were paid for; changing them means withdrawing (refunded) and applying again
  if (paidDates !== null && !errors.startsAt && !errors.endsAt && [ad.startsAt, ad.endsAt].map(d => (d ? d.getTime() : 0)).join() !== paidDates) {
    errors.startsAt = 'The dates of a paid ad can\'t change. Delete it for a refund and apply again with new dates.';
  }
  if (paidTour !== null && !errors.tour && String(ad.tour) !== paidTour) errors.tour = 'The tour of a paid ad can\'t change. Delete it for a refund and apply again.';
  if (tour && !errors.tour && await openAdFor(tour._id, ad._id)) errors.tour = 'This tour already has an ad waiting for review or running.';
  if (Object.keys(errors).length) return fieldErrors(res, errors);
  if (req.file) {
    const old = ad.image;
    ad.image = await saveContentImage(req.file, 'promotions', ad._id, { width: 1600 });
    await removeContentImage(old);
  }
  const resent = ad.reviewStatus === 'rejected';
  const unpaid = ad.reviewStatus === 'unpaid' && (await adPayments.quote(ad)).amount > 0;
  if (unpaid) {
    await ad.save();
    await logActivity(req, { action: 'ad.updated', summary: `Changed an unpaid ad: ${ad.title}`, agency: req.agency._id });
    return res.status(200).json({ status: 'success', message: 'Your ad was saved. Pay for it to send it for review.', data: { ad: { ...adView({ ...ad.toObject(), tour }), due: await adPayments.quote(ad) } } });
  }
  ad.reviewStatus = 'pending';
  ad.rejectedReason = '';
  ad.reviewedBy = undefined;
  ad.reviewedAt = undefined;
  await ad.save();
  await logActivity(req, { action: resent ? 'ad.resubmitted' : 'ad.updated', summary: `${resent ? 'Sent again' : 'Changed'} an ad: ${ad.title}`, agency: req.agency._id });
  res.status(200).json({ status: 'success', message: resent ? 'Your ad was sent for review again.' : 'Your ad was saved.', data: { ad: adView({ ...ad.toObject(), tour }) } });
});

// DELETE /agency/me/ads/:id — take back an ad under review or rejected; stop one that's accepted (its numbers stay)
exports.removeMyAd = catchAsync(async (req, res) => {
  const ad = await findMyAd(req);
  if (ad.reviewStatus === 'approved') {
    ad.active = false;
    ad.stoppedAt = new Date();
    await ad.save();
    await logActivity(req, { action: 'ad.stopped', summary: `Stopped an ad: ${ad.title}`, agency: req.agency._id });
    return res.status(200).json({ status: 'success', message: 'Your ad no longer shows in the app.', data: { ad: adView(ad.toObject()) } });
  }
  // An ad that never ran gets its money back
  const paid = await adPayments.paidPaymentFor(ad);
  const refund = paid ? await adPayments.refundPayment(paid, { reason: 'Ad withdrawn before it ran', by: req.user._id }) : null;
  await removeContentFolder('promotions', ad._id);
  await ad.deleteOne();
  await logActivity(req, { action: 'ad.withdrawn', summary: `Withdrew an ad: ${ad.title}${refund ? `. Refund of ${refund.amount} BDT: ${refund.status}` : ''}`, agency: req.agency._id });
  if (!refund) return res.status(204).json({ status: 'success', data: null });
  const name = adPayments.GATEWAY_NAMES[refund.method];
  res.status(200).json({
    status: 'success',
    message: refund.status === 'refunded'
      ? `Ad deleted. ${refund.amount} taka is on its way back to you through ${name}.`
      : `Ad deleted. ${name} couldn't refund the ${refund.amount} taka automatically, so Plejar will refund you by hand.`,
    data: { refund: { amount: refund.amount, method: refund.method, status: refund.status, ref: refund.refund.ref || '' } }
  });
});

/**
 * POST /agency/me/ads/:id/pay { method: 'bkash' | 'sslcommerz' } — opens a payment for an unpaid ad.
 * Returns { redirectUrl } for the gateway's page; the gateway sends the vendor back to /agent.
 */
exports.payForAd = catchAsync(async (req, res, next) => {
  const ad = await findMyAd(req);
  if (ad.reviewStatus !== 'unpaid') return next(new AppError('This ad is already paid for.', 400));
  const tour = await Package.findOne({ _id: ad.tour, agency: req.agency._id }).select('status hiddenByAdmin startDate');
  const today = isoDay(new Date(Date.now() + 6 * 3600 * 1000));
  if (!tour || tour.status !== 'published' || tour.hiddenByAdmin) return next(new AppError('Only a published tour can be advertised. Publish the tour, then pay.', 400));
  if ((ad.startsAt && isoDay(new Date(ad.startsAt.getTime() + 6 * 3600 * 1000)) < today) || (ad.endsAt && ad.endsAt < new Date())) {
    return next(new AppError('The dates on this ad have passed. Edit it with new dates, then pay.', 400));
  }
  const started = await adPayments.startAdPayment(req, ad, String(req.body.method || ''));
  if (started.free) {
    // Ads became free since it was saved
    ad.reviewStatus = 'pending';
    await ad.save();
    return res.status(200).json({ status: 'success', message: 'Ads are free right now, so your ad went straight to review.', data: { free: true } });
  }
  res.status(200).json({ status: 'success', data: { redirectUrl: started.redirectUrl, amount: started.quote.amount, days: started.quote.days } });
});

// ---------- Admin ----------

// Tell whoever applied. A mail problem never undoes the decision.
const mailDecision = async (req, ad, { accepted, reason }) => {
  if (!Email.isConfigured() || !ad.createdBy) return;
  try {
    const user = await User.findById(ad.createdBy).select('name firstName email');
    if (user && user.email) await new Email(user, `${req.protocol}://${req.get('host')}/agent#ads`, { accepted, reason, adTitle: ad.title, agencyName: ad.agency.name }).sendAdDecision();
  } catch (err) {
    console.warn('[MAIL WARNING] Ad decision not sent:', err.message);
  }
};

const adminAdView = ad => ({
  ...adView(ad),
  agency: ad.agency && ad.agency.name ? { _id: ad.agency._id, name: ad.agency.name, logo: ad.agency.logo || '', verified: Boolean(ad.agency.verified) } : null,
  submittedBy: ad.createdBy && ad.createdBy.name ? { name: ad.createdBy.name, email: ad.createdBy.email || '' } : null,
  reviewedBy: ad.reviewedBy && ad.reviewedBy.name ? ad.reviewedBy.name : ''
});

const loadForReview = async (id, next) => {
  const ad = validId(id) ? await Promotion.findOne({ _id: id, source: 'vendor' }).populate('agency', 'name status') : null;
  if (!ad) next(new AppError('No ad request with that ID.', 404));
  else if (ad.reviewStatus !== 'pending') next(new AppError('This ad has already been reviewed.', 400));
  else return ad;
  return null;
};

// GET /admin/ad-requests?status=pending|approved|rejected
exports.adminAdRequests = catchAsync(async (req, res) => {
  // Unpaid ads stay with the vendor until they pay
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const [rows, counts] = await Promise.all([
    Promotion.find({ source: 'vendor', reviewStatus: status }).sort({ createdAt: status === 'pending' ? 1 : -1 }).limit(100)
      .populate('agency', 'name logo verified').populate('tour', 'title startDate status').populate('createdBy', 'name email').populate('reviewedBy', 'name').populate('payment', PAYMENT_FIELDS).lean(),
    Promotion.aggregate([{ $match: { source: 'vendor' } }, { $group: { _id: '$reviewStatus', n: { $sum: 1 } } }])
  ]);
  const byStatus = Object.fromEntries(counts.map(c => [c._id, c.n]));
  res.status(200).json({
    status: 'success',
    data: { ads: rows.map(adminAdView), counts: { pending: byStatus.pending || 0, approved: byStatus.approved || 0, rejected: byStatus.rejected || 0 } }
  });
});

/** POST /admin/ad-requests/:id/approve { order? } — the ad becomes a slide in the app, from its start date */
exports.adminApprove = catchAsync(async (req, res, next) => {
  const ad = await loadForReview(req.params.id, next);
  if (!ad) return;
  const tour = await Package.findById(ad.tour).select('status hiddenByAdmin');
  if (!tour || tour.status !== 'published' || tour.hiddenByAdmin) return next(new AppError("This ad's tour is no longer published, so it can't be accepted.", 400));
  if (ad.endsAt && ad.endsAt < new Date()) return next(new AppError('The dates on this ad have passed. Reject it so the vendor can choose new ones.', 400));
  if (req.body.order !== undefined && req.body.order !== '') ad.order = Number(req.body.order) || 0;
  ad.reviewStatus = 'approved';
  ad.active = true;
  ad.reviewedBy = req.user._id;
  ad.reviewedAt = new Date();
  await ad.save();
  await logActivity(req, { action: 'ad.approved', summary: `Accepted an ad from ${ad.agency.name}: ${ad.title}`, agency: ad.agency._id });
  await mailDecision(req, ad, { accepted: true });
  res.status(200).json({ status: 'success', message: 'Ad accepted. It now shows on the Tours screen during its dates.', data: { ad: adView(ad.toObject()) } });
});

// POST /admin/ad-requests/:id/reject { reason } — the vendor sees the reason and can fix the ad
exports.adminReject = catchAsync(async (req, res, next) => {
  const reason = text(req.body.reason, 500);
  if (reason.length < 3) return next(new AppError('Tell the vendor why, so they can fix it.', 400));
  const ad = await loadForReview(req.params.id, next);
  if (!ad) return;
  ad.reviewStatus = 'rejected';
  ad.active = false;
  ad.rejectedReason = reason;
  ad.reviewedBy = req.user._id;
  ad.reviewedAt = new Date();
  await ad.save();
  await logActivity(req, { action: 'ad.rejected', summary: `Rejected an ad from ${ad.agency.name}: ${ad.title}. Reason: ${reason}`, agency: ad.agency._id });
  await mailDecision(req, ad, { accepted: false, reason });
  res.status(200).json({ status: 'success', message: 'Ad rejected. The vendor can see your reason.', data: { ad: adView(ad.toObject()) } });
});
