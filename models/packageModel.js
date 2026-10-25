const mongoose = require('mongoose');

// The full tour plan a vendor declares before publishing (see utils/tourPlan.js for what's required)
const STOP_KINDS = ['departure', 'stop', 'activity', 'meal', 'stay', 'return'];
const TRANSPORT = ['bus', 'ac_bus', 'train', 'launch', 'plane', 'jeep', 'boat', 'car', 'walking', 'mixed'];
const STAYS = ['none', 'hotel', 'resort', 'cottage', 'camp', 'houseboat', 'homestay', 'mixed'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const stopSchema = new mongoose.Schema({
  time: { type: String, default: '', validate: { validator: v => !v || TIME.test(v), message: 'Use a 24-hour time like 06:30' } },
  place: { type: String, trim: true, maxlength: [120, 'Keep each place under 120 characters'], required: [true, 'Every stop needs a place'] },
  destinationRef: { type: mongoose.Schema.ObjectId, ref: 'Destination' },
  kind: { type: String, enum: STOP_KINDS, default: 'stop' },
  note: { type: String, trim: true, maxlength: [300, 'Keep each stop note under 300 characters'], default: '' }
}, { _id: false });

const daySchema = new mongoose.Schema({
  day: { type: Number, min: 1, max: 60, required: true },
  title: { type: String, trim: true, maxlength: [120, 'Keep each day title under 120 characters'], default: '' },
  stops: { type: [stopSchema], default: [] },
  stay: { type: String, trim: true, maxlength: [120, 'Keep the overnight stay under 120 characters'], default: '' },
  meals: {
    breakfast: { type: Boolean, default: false },
    lunch: { type: Boolean, default: false },
    dinner: { type: Boolean, default: false }
  }
}, { _id: false });

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
    // Display text for the destination (filled in from destinationRef, the shared destination)
    destination: {
      type: String,
      trim: true,
      maxlength: [120, 'Destination must be 120 characters or fewer'],
      default: ''
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
    // Tour event schedule: travelers register for these dates (older packages may have none)
    startDate: Date,
    endDate: Date,
    registrationDeadline: Date,
    seats: { type: Number, min: [1, 'An event needs at least 1 seat'], max: [1000, 'An event can have at most 1000 seats'] },
    meetingPoint: { type: String, trim: true, maxlength: [200, 'Meeting point must be 200 characters or fewer'], default: '' },
    departureTime: { type: String, default: '', validate: { validator: v => !v || TIME.test(v), message: 'Use a 24-hour departure time like 21:30' } },
    returnInfo: { type: String, trim: true, maxlength: [200, 'Keep the return details under 200 characters'], default: '' },

    // Tour plan
    itinerary: { type: [daySchema], default: [] },
    transport: {
      mode: { type: String, enum: { values: TRANSPORT, message: 'Choose how travelers get there' } },
      details: { type: String, trim: true, maxlength: [300, 'Keep transport details under 300 characters'], default: '' }
    },
    accommodation: {
      type: { type: String, enum: { values: STAYS, message: 'Choose where travelers stay' } },
      details: { type: String, trim: true, maxlength: [300, 'Keep stay details under 300 characters'], default: '' }
    },
    childPrice: { type: Number, min: [0, 'Child price cannot be negative'], default: null },
    advanceAmount: { type: Number, min: [0, 'The advance cannot be negative'], default: null },
    excluded: { type: [String], default: [] },
    whatToBring: { type: [String], default: [] },
    difficulty: { type: String, enum: { values: ['easy', 'moderate', 'challenging'], message: 'Choose easy, moderate or challenging' } },
    cancellationPolicy: { type: String, trim: true, maxlength: [1500, 'Keep the cancellation policy under 1500 characters'], default: '' },

    status: {
      type: String,
      enum: ['draft', 'published', 'hidden', 'cancelled'],
      default: 'draft'
    },
    cancelledAt: Date,
    cancelReason: { type: String, trim: true, maxlength: 500, default: '' },
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

packageSchema.index({ status: 1, startDate: 1 });

const Package = mongoose.model('Package', packageSchema);
Package.STOP_KINDS = STOP_KINDS;
Package.TRANSPORT = TRANSPORT;
Package.STAYS = STAYS;
module.exports = Package;
