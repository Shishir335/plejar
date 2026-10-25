const mongoose = require('mongoose');

/**
 * A traveler's recent tour searches, for "Continue Your Search" on the Tours screen.
 * The same search again only moves it to the top. Old ones are trimmed to the latest 10.
 */
const tourSearchSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true, index: true },
    // The same filters in the same order give the same key, so repeats are merged
    key: { type: String, required: true },
    query: { type: String, trim: true, maxlength: 120, default: '' },
    tourType: { type: String, default: '' },
    destination: { type: mongoose.Schema.ObjectId, ref: 'Destination' },
    from: Date,
    to: Date,
    adults: { type: Number, min: 0, max: 50, default: null },
    children: { type: Number, min: 0, max: 50, default: null },
    // Anything else the app filtered by (price, duration, difficulty...), kept to rerun the search
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    resultCount: { type: Number, default: 0 },
    searchedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

tourSearchSchema.index({ user: 1, key: 1 }, { unique: true });
tourSearchSchema.index({ user: 1, searchedAt: -1 });

module.exports = mongoose.model('TourSearch', tourSearchSchema);
