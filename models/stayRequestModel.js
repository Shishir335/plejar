const mongoose = require('mongoose');

// A traveler asking a hotel for a stay. The hotel accepts or declines it from its panel (/hotel);
// payment is settled between the guest and the hotel.
// 'expired': the hotel didn't answer within ANSWER_WITHIN, so the rooms were let go (utils/stayExpiry.js)
const STATUSES = ['pending', 'accepted', 'declined', 'cancelled', 'expired'];
const ANSWER_WITHIN = 24 * 60 * 60 * 1000;

const stayRequestSchema = new mongoose.Schema(
  {
    hotel: { type: mongoose.Schema.ObjectId, ref: 'Hotel', required: true, index: true },
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', index: true },
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true, index: true },
    // The rooms asked for: one line per room type, with its name and price as they were when the guest asked
    items: {
      type: [new mongoose.Schema({
        roomType: { type: mongoose.Schema.ObjectId, required: true },
        roomName: { type: String, trim: true, maxlength: 60, default: '' },
        pricePerNight: { type: Number, min: 0, default: 0 },
        quantity: { type: Number, min: 1, max: 50, default: 1 }
      }, { _id: false })],
      default: []
    },
    // Kept for older app versions and older requests: the first room type, a summary such as
    // "2 × Deluxe, 1 × Normal", and that first room type's price. `rooms` is the total of all lines.
    roomType: { type: mongoose.Schema.ObjectId },
    roomName: { type: String, trim: true, maxlength: 120, default: '' },
    pricePerNight: { type: Number, min: 0, default: 0 },
    // What all the rooms cost for one night
    nightlyTotal: { type: Number, min: 0, default: 0 },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, required: true },
    nights: { type: Number, min: 1, required: true },
    rooms: { type: Number, min: 1, max: 100, default: 1 },
    guests: { type: Number, min: 1, max: 100, default: 1 },
    estimatedTotal: { type: Number, min: 0, default: 0 },
    guestName: { type: String, trim: true, maxlength: 80, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: STATUSES, default: 'pending', index: true },
    // The hotel's answer to the guest, shown with an accept or decline
    hotelNote: { type: String, trim: true, maxlength: 1000, default: '' },
    decidedAt: Date,
    decidedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    cancelledAt: Date,
    expiredAt: Date
  },
  { timestamps: true }
);

stayRequestSchema.index({ hotel: 1, status: 1, checkIn: 1 });

const StayRequest = mongoose.model('StayRequest', stayRequestSchema);
StayRequest.STATUSES = STATUSES;
StayRequest.ANSWER_WITHIN = ANSWER_WITHIN;
// When a waiting request stops holding its rooms
StayRequest.expiresAt = r => new Date(new Date(r.createdAt).getTime() + ANSWER_WITHIN);
module.exports = StayRequest;
