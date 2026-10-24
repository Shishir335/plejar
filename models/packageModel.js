const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema(
  {
    agency: {
      type: mongoose.Schema.ObjectId,
      ref: 'Agency',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: [true, 'Please enter a package title'],
      trim: true,
      maxlength: [120, 'Title must be 120 characters or fewer']
    },
    destination: {
      type: String,
      required: [true, 'Please enter the destination'],
      trim: true,
      maxlength: [120, 'Destination must be 120 characters or fewer']
    },
    durationDays: {
      type: Number,
      required: [true, 'Please enter the number of days'],
      min: [1, 'A package must be at least 1 day'],
      max: [60, 'A package can be at most 60 days']
    },
    durationNights: {
      type: Number,
      min: [0, 'Nights cannot be negative'],
      max: [60, 'A package can be at most 60 nights'],
      default: 0
    },
    priceFrom: {
      type: Number,
      required: [true, 'Please enter the starting price'],
      min: [0, 'Price cannot be negative']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [3000, 'Description must be 3000 characters or fewer'],
      default: ''
    },
    included: {
      type: [String],
      default: []
    },
    photos: {
      type: [String],
      default: []
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'hidden'],
      default: 'draft'
    },
    // Set when a master admin hides a package; the agency cannot republish it
    hiddenByAdmin: { type: Boolean, default: false },
    // Optional link to a managed destination (set from the agency panel)
    destinationRef: { type: mongoose.Schema.ObjectId, ref: 'Destination', index: true },
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  {
    timestamps: true
  }
);

const Package = mongoose.model('Package', packageSchema);
module.exports = Package;
