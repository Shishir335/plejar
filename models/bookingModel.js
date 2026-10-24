const mongoose = require('mongoose');
const crypto = require('crypto');

// Short readable reference shown to travelers and in admin, for example PLZ-7K3QX9
const makeReference = () => `PLZ-${crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase()}`;

const bookingSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, default: makeReference },
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true, index: true },
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', required: true, index: true },
    package: { type: mongoose.Schema.ObjectId, ref: 'Package', required: true },

    // Snapshots, so history stays correct if the package is renamed or repriced later
    packageTitle: { type: String, required: true },
    destination: { type: String, default: '' },
    destinationRef: { type: mongoose.Schema.ObjectId, ref: 'Destination' },

    travelDate: { type: Date, required: true },
    travelers: { type: Number, required: true, min: [1, 'At least one traveler'], max: [50, 'At most 50 travelers'] },
    pricePerPerson: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 }, // total charged to the traveler, in taka

    commissionRate: { type: Number, required: true, min: 0, max: 100 }, // percent, snapshot at booking time
    commissionAmount: { type: Number, required: true, min: 0 }, // Plezar's share of `amount`

    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled'],
      default: 'pending',
      index: true
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'partially_refunded', 'refunded'],
      default: 'unpaid'
    },
    paidAt: Date,
    cancelledAt: Date,
    cancelReason: { type: String, trim: true, maxlength: 500, default: '' },
    note: { type: String, trim: true, maxlength: 500, default: '' }
  },
  { timestamps: true }
);

bookingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Booking', bookingSchema);
