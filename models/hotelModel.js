const mongoose = require('mongoose');

/**
 * Hotels and resorts listed by Plezar, for "Hotels Near You" on the Tours screen
 * (and the Hotels tab later). Located at a destination and on the map.
 */
const STAY_TYPES = ['hotel', 'resort', 'cottage', 'guest_house', 'homestay', 'eco_resort', 'houseboat'];

const hotelSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Enter the hotel name'], trim: true, maxlength: [120, 'Keep the name under 120 characters'] },
    type: { type: String, enum: { values: STAY_TYPES, message: 'Choose the kind of stay' }, default: 'hotel' },
    description: { type: String, trim: true, maxlength: [3000, 'Keep the description under 3000 characters'], default: '' },
    photos: { type: [String], default: [] },

    destination: { type: mongoose.Schema.ObjectId, ref: 'Destination', index: true },
    address: { type: String, trim: true, maxlength: [200, 'Keep the address under 200 characters'], default: '' },
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number], default: undefined } // [lng, lat]
    },

    // Taka per night; regularPrice shows struck through when higher (a sale)
    pricePerNight: { type: Number, min: [0, 'The price cannot be negative'], required: [true, 'Enter the price per night'] },
    regularPrice: { type: Number, min: [0, 'The regular price cannot be negative'], default: null },
    // Short selling points, such as "Free breakfast available"
    highlights: { type: [String], default: [] },
    amenities: { type: [String], default: [] },
    starRating: { type: Number, min: 1, max: 5, default: null },
    // Guest rating from a source Plezar trusts (until hotel reviews come to the app)
    rating: {
      average: { type: Number, min: 0, max: 5, default: null },
      count: { type: Number, min: 0, default: 0 },
      source: { type: String, trim: true, maxlength: 40, default: '' }
    },

    phone: { type: String, trim: true, maxlength: 30, default: '' },
    website: { type: String, trim: true, maxlength: 200, default: '' },
    checkIn: { type: String, trim: true, maxlength: 10, default: '' },
    checkOut: { type: String, trim: true, maxlength: 10, default: '' },

    featured: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'published', 'hidden'], default: 'draft', index: true },
    viewCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

hotelSchema.index({ location: '2dsphere' }, { sparse: true });
hotelSchema.index({ status: 1, featured: -1, name: 1 });

hotelSchema.virtual('discountPercent').get(function () {
  if (!this.regularPrice || this.pricePerNight >= this.regularPrice) return 0;
  return Math.round(((this.regularPrice - this.pricePerNight) / this.regularPrice) * 100);
});

const Hotel = mongoose.model('Hotel', hotelSchema);
Hotel.STAY_TYPES = STAY_TYPES;
module.exports = Hotel;
