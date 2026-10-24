const mongoose = require('mongoose');

const vendorCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Enter a category name'], trim: true, maxlength: [60, 'Name must be 60 characters or fewer'], unique: true },
    description: { type: String, trim: true, maxlength: [300, 'Description must be 300 characters or fewer'], default: '' },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('VendorCategory', vendorCategorySchema);
