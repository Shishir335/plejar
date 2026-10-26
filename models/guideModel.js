const mongoose = require('mongoose');

/**
 * A tour guide on an agency's team, shown on the tour page ("Your Tour Guide").
 * A profile only: guides don't sign in. The agency picks one guide per tour.
 */
const guideSchema = new mongoose.Schema(
  {
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', required: true, index: true },
    name: { type: String, required: [true, "Enter the guide's name"], trim: true, maxlength: [80, 'Keep the name under 80 characters'] },
    photo: { type: String, default: '' },
    // Where the guide is based, such as "Cox's Bazar, Bangladesh"
    location: { type: String, trim: true, maxlength: [120, 'Keep the location under 120 characters'], default: '' },
    languages: { type: [String], default: [] },
    experienceYears: { type: Number, min: [0, 'Experience cannot be negative'], max: [70, 'Check the years of experience'], default: null },
    bio: { type: String, trim: true, maxlength: [1500, 'Keep the bio under 1500 characters'], default: '' },
    // For the agency only; never shown in the app
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    active: { type: Boolean, default: true },

    // Travelers can also hire the guide on their own ("Guide" in My Bookings)
    bookable: { type: Boolean, default: false },
    title: { type: String, trim: true, maxlength: [60, 'Keep the title under 60 characters'], default: '' }, // "Local Expert"
    pricePerDay: { type: Number, min: [0, 'The price cannot be negative'], default: null },
    regularPrice: { type: Number, min: [0, 'The regular price cannot be negative'], default: null },
    destination: { type: mongoose.Schema.ObjectId, ref: 'Destination' },
    mapLocation: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number], default: undefined } // [lng, lat]
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Guide', guideSchema);
