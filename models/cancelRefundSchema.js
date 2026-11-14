const mongoose = require('mongoose');

/**
 * A cancellation refund, set by an agency on a tour or by a hotel: a traveler who cancels a confirmed
 * booking (or accepted stay) at least `days` days before it starts gets `percent` of the booking money
 * back. Later than that, none. Before it's confirmed, the booking money always comes back in full.
 */
const CANCEL_REFUND = new mongoose.Schema(
  {
    days: { type: Number, required: true, min: [1, 'Cancel at least 1 day before'], max: [365, 'At most 365 days'] },
    percent: { type: Number, required: true, min: [0, 'The refund cannot be below 0%'], max: [100, 'The refund cannot be above 100%'] }
  },
  { _id: false }
);

module.exports = { CANCEL_REFUND };
