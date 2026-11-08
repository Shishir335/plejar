const mongoose = require('mongoose');

/**
 * Hotels and resorts listed by Plejar, for "Hotels Near You" on the Tours screen
 * (and the Hotels tab later). Located at a destination and on the map.
 */
const STAY_TYPES = ['hotel', 'resort', 'cottage', 'guest_house', 'homestay', 'eco_resort', 'houseboat'];
// What comes with a room, shown as ticks on the room in the app
const ROOM_BENEFITS = ['breakfast', 'free_cancellation', 'pay_at_hotel', 'free_wifi', 'free_parking', 'airport_pickup', 'late_checkout', 'welcome_drink'];

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
    // Guest rating from a source Plejar trusts (until hotel reviews come to the app)
    rating: {
      average: { type: Number, min: 0, max: 5, default: null },
      count: { type: Number, min: 0, default: 0 },
      source: { type: String, trim: true, maxlength: 40, default: '' }
    },

    phone: { type: String, trim: true, maxlength: 30, default: '' },
    website: { type: String, trim: true, maxlength: 200, default: '' },
    checkIn: { type: String, trim: true, maxlength: 10, default: '' },
    checkOut: { type: String, trim: true, maxlength: 10, default: '' },

    rooms: { type: Number, min: [1, 'Enter how many rooms there are'], default: null },

    // Room types the hotel manages from its own panel (/hotel). Travelers request a stay in one of them.
    roomTypes: {
      type: [
        new mongoose.Schema({
          name: { type: String, required: [true, 'Name the room type'], trim: true, maxlength: [60, 'Keep the room name under 60 characters'] },
          description: { type: String, trim: true, maxlength: [600, 'Keep the room description under 600 characters'], default: '' },
          pricePerNight: { type: Number, required: [true, 'Enter the price per night'], min: [0, 'The price cannot be negative'] },
          regularPrice: { type: Number, min: 0, default: null },
          maxGuests: { type: Number, min: [1, 'At least 1 guest'], max: [20, 'Up to 20 guests a room'], default: 2 },
          beds: { type: String, trim: true, maxlength: 60, default: '' },
          sizeSqft: { type: Number, min: 0, max: 20000, default: null },
          count: { type: Number, min: [1, 'At least 1 room of this type'], max: 500, default: 1 },
          amenities: { type: [String], default: [] },
          benefits: { type: [{ type: String, enum: ROOM_BENEFITS }], default: [] },
          photos: { type: [String], default: [] },
          active: { type: Boolean, default: true }
        }, { timestamps: true })
      ],
      default: []
    },
    // House rules guests see before they ask for a stay
    policies: {
      cancellation: { type: String, trim: true, maxlength: 1000, default: '' },
      children: { type: String, trim: true, maxlength: 500, default: '' },
      pets: { type: String, trim: true, maxlength: 300, default: '' },
      smoking: { type: String, trim: true, maxlength: 300, default: '' },
      other: { type: String, trim: true, maxlength: 1000, default: '' }
    },

    // Breakfast and dining. The breakfast photo is one of the hotel's photos.
    dining: {
      breakfast: { type: String, enum: ['', 'included', 'extra'], default: '' },
      breakfastPhoto: { type: String, trim: true, maxlength: 500, default: '' },
      meals: { type: [String], default: [] },
      facilities: { type: [String], default: [] }
    },
    // Places a short walk away: restaurants, cafes, shops and sights, with the distance in metres
    nearby: {
      type: [
        new mongoose.Schema({
          category: { type: String, enum: ['restaurant', 'cafe', 'grocery', 'attraction', 'transport'], required: true },
          name: { type: String, required: true, trim: true, maxlength: 80 },
          distance: { type: Number, min: 0, max: 100000, default: null }
        }, { _id: false })
      ],
      default: []
    },
    centreDistanceKm: { type: Number, min: 0, max: 1000, default: null },

    // The hotel's own vendor account, when the hotel joined through /apply. Plejar still publishes the listing.
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', index: true },
    sourceLead: { type: mongoose.Schema.ObjectId, ref: 'AgentLead' },

    featured: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'published', 'hidden'], default: 'draft', index: true },
    viewCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

hotelSchema.index({ location: '2dsphere' }, { sparse: true });
hotelSchema.index({ status: 1, featured: -1, name: 1 });

// A breakfast photo that was removed from the hotel's photos is no longer shown
hotelSchema.pre('save', function () {
  if (this.dining && this.dining.breakfastPhoto && !(this.photos || []).includes(this.dining.breakfastPhoto)) {
    this.dining.breakfastPhoto = '';
  }
});

hotelSchema.virtual('discountPercent').get(function () {
  if (!this.regularPrice || this.pricePerNight >= this.regularPrice) return 0;
  return Math.round(((this.regularPrice - this.pricePerNight) / this.regularPrice) * 100);
});

const Hotel = mongoose.model('Hotel', hotelSchema);
Hotel.STAY_TYPES = STAY_TYPES;
Hotel.ROOM_BENEFITS = ROOM_BENEFITS;
module.exports = Hotel;
