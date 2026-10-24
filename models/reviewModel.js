const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true, index: true },
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', required: true, index: true },
    package: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    booking: { type: mongoose.Schema.ObjectId, ref: 'Booking', required: true, unique: true }, // one review per booking
    rating: { type: Number, required: [true, 'Please give a rating'], min: [1, 'Rating is 1 to 5'], max: [5, 'Rating is 1 to 5'] },
    comment: { type: String, trim: true, maxlength: [1500, 'Review must be 1500 characters or fewer'], default: '' },

    status: { type: String, enum: ['visible', 'hidden'], default: 'visible', index: true },
    hiddenReason: { type: String, trim: true, maxlength: 300, default: '' },
    hiddenBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    hiddenAt: Date
  },
  { timestamps: true }
);

reviewSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
