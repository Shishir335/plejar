const mongoose = require('mongoose');

/**
 * Banners at the top of the app's Tours screen, such as "Summer Adventure Sale - Up to 30% Off
 * on selected tours". "Explore Now" opens the tours the promotion points at.
 */
const TARGETS = ['sale_tours', 'tours', 'destination', 'agency', 'tour_type'];

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
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

promotionSchema.index({ active: 1, order: 1 });

// Live now: switched on and inside its dates
promotionSchema.statics.liveFilter = (now = new Date()) => ({
  active: true,
  $and: [
    { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
    { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] }
  ]
});

const Promotion = mongoose.model('Promotion', promotionSchema);
Promotion.TARGETS = TARGETS;
module.exports = Promotion;
