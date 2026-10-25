const mongoose = require('mongoose');

// Places travelers browse: countries, regions (divisions), cities or districts, and attractions.
// They form a tree through `parent`; `ancestors` keeps the whole path for quick queries.
const TYPES = ['country', 'region', 'city', 'attraction'];
// Which type each type may sit under
const PARENT_TYPES = { country: [], region: ['country'], city: ['region', 'country'], attraction: ['city', 'region', 'country'] };
const AVAILABILITY = ['open', 'seasonal', 'restricted', 'closed'];

const photoSchema = new mongoose.Schema({
  url: { type: String, required: true },
  caption: { type: String, trim: true, maxlength: 200, default: '' },
  credit: { type: String, trim: true, maxlength: 200, default: '' }
});

const destinationSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Enter the name'], trim: true, maxlength: [120, 'Name must be 120 characters or fewer'] },
    nameBn: { type: String, trim: true, maxlength: [120, 'Bangla name must be 120 characters or fewer'], default: '' },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 140,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'The web address can only use letters, numbers and dashes']
    },
    type: { type: String, enum: { values: TYPES, message: 'Choose a type' }, required: true },
    // 0 country, 1 region, 2 city, 3 attraction: lets lists sort from the top of the tree down
    level: { type: Number, default: 0 },
    parent: { type: mongoose.Schema.ObjectId, ref: 'Destination', default: null },
    ancestors: [{ type: mongoose.Schema.ObjectId, ref: 'Destination' }],

    // Content
    summary: { type: String, trim: true, maxlength: [300, 'Keep the summary under 300 characters'], default: '' },
    description: { type: String, trim: true, maxlength: [6000, 'Keep the description under 6000 characters'], default: '' },
    highlights: { type: [String], default: [] },
    howToGetThere: { type: String, trim: true, maxlength: [2000, 'Keep this under 2000 characters'], default: '' },
    travelTips: { type: String, trim: true, maxlength: [2000, 'Keep the tips under 2000 characters'], default: '' },
    // Best months to visit, 1 = January
    bestMonths: { type: [Number], default: [] },
    categories: [{ type: mongoose.Schema.ObjectId, ref: 'DestinationCategory' }],

    // Map
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number], default: undefined } // [longitude, latitude]
    },
    address: { type: String, trim: true, maxlength: 200, default: '' },

    // Media
    coverImage: { type: String, default: '' },
    gallery: { type: [photoSchema], default: [] },
    videoUrl: { type: String, trim: true, maxlength: 300, default: '' },

    // Can people visit right now?
    availability: {
      status: { type: String, enum: AVAILABILITY, default: 'open' },
      openMonths: { type: [Number], default: [] },
      note: { type: String, trim: true, maxlength: 500, default: '' }
    },

    // Promotion
    featured: { type: Boolean, default: false },
    featuredOrder: { type: Number, default: 0 },
    trendingPinned: { type: Boolean, default: false },

    seo: {
      title: { type: String, trim: true, maxlength: [70, 'Keep the search title under 70 characters'], default: '' },
      description: { type: String, trim: true, maxlength: [170, 'Keep the search description under 170 characters'], default: '' },
      keywords: { type: [String], default: [] }
    },

    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    views: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

destinationSchema.index({ location: '2dsphere' }, { sparse: true });
destinationSchema.index({ parent: 1, type: 1 });
destinationSchema.index({ ancestors: 1 });
destinationSchema.index({ status: 1, featured: 1, featuredOrder: 1 });
destinationSchema.index({ name: 'text', nameBn: 'text', summary: 'text' });

destinationSchema.pre('save', function (next) {
  this.level = TYPES.indexOf(this.type);
  next();
});

const Destination = mongoose.model('Destination', destinationSchema);
Destination.TYPES = TYPES;
Destination.PARENT_TYPES = PARENT_TYPES;
Destination.AVAILABILITY = AVAILABILITY;
module.exports = Destination;
