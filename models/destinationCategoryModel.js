const mongoose = require('mongoose');

// Kinds of places: beaches, hills, forests, heritage sites...
const destinationCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Enter a category name'], trim: true, maxlength: [60, 'Name must be 60 characters or fewer'], unique: true },
    nameBn: { type: String, trim: true, maxlength: 60, default: '' },
    description: { type: String, trim: true, maxlength: [300, 'Description must be 300 characters or fewer'], default: '' },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('DestinationCategory', destinationCategorySchema);
