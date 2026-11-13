const mongoose = require('mongoose');

/**
 * Banners at the top of the app's Tours screen, such as "Summer Adventure Sale - Up to 30% Off
 * on selected tours". "Explore Now" opens the tours the promotion points at.
 * Plejar adds banners itself; vendors apply for an ad for one of their tours (source: 'vendor'),
 * which shows only after a Plejar admin accepts it (controllers/adController.js).
 */
const TARGETS = ['sale_tours', 'tours', 'destination', 'agency', 'tour_type'];
const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];

const promotionSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Give the banner a title'], trim: true, maxlength: [60, 'Keep the title under 60 characters'] },
    // "Up to 30% Off on selected tours": the highlighted part is shown in colour
    subtitle: { type: String, trim: true, maxlength: [100, 'Keep the subtitle under 100 characters'], default: '' },
    highlight: { type: String, trim: true, maxlength: [30, 'Keep the highlight under 30 characters'], default: '' },
    ctaLabel: { type: String, trim: true, maxlength: [24, 'Keep the button text under 24 characters'], default: 'Explore Now' },
    image: { type: String, default: '' },

    // What "Explore Now" opens
    target: { type: String, enum: { values: TARGETS, message: 'Choose what the banner opens' }, default: 'sale_tours' },
    tours: [{ type: mongoose.Schema.ObjectId, ref: 'Package' }],
    destination: { type: mongoose.Schema.ObjectId, ref: 'Destination' },
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency' },
    tourType: { type: String, default: '' },
    // For sale_tours: only tours at least this much off
    minDiscount: { type: Number, min: 0, max: 100, default: 0 },

    startsAt: Date,
    endsAt: Date,
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    // Times an agent's ad was shown in the app; ads that have been shown least go first (utils/adRanking.js)
    views: { type: Number, default: 0 },
    lastShownAt: Date,
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' },

    // Vendor ads: the tour advertised, and the admin's decision
    source: { type: String, enum: ['admin', 'vendor'], default: 'admin' },
    tour: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: 'approved' },
    rejectedReason: { type: String, trim: true, maxlength: 500, default: '' },
    reviewedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    reviewedAt: Date,
    // The vendor took an accepted ad down, or its tour was cancelled
    stoppedAt: Date
  },
  { timestamps: true }
);

promotionSchema.index({ active: 1, order: 1 });
promotionSchema.index({ source: 1, reviewStatus: 1, createdAt: -1 });
promotionSchema.index({ agency: 1, source: 1, createdAt: -1 });

// Live now: switched on, accepted and inside its dates (banners from before reviews have no status)
promotionSchema.statics.liveFilter = (now = new Date()) => ({
  active: true,
  reviewStatus: { $in: ['approved', null] },
  $and: [
    { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
    { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] }
  ]
});

const Promotion = mongoose.model('Promotion', promotionSchema);
Promotion.TARGETS = TARGETS;
Promotion.REVIEW_STATUSES = REVIEW_STATUSES;
module.exports = Promotion;
