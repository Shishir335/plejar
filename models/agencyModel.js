const mongoose = require('mongoose');
const validator = require('validator');

const documentSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['trade_license', 'nid'],
      required: true
    },
    // Stored outside /public; served only through an authenticated route
    file: { type: String, required: true, select: false },
    originalName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  }
);

const agencySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please enter the agency name'],
      trim: true,
      maxlength: [120, 'Agency name must be 120 characters or fewer']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1500, 'Description must be 1500 characters or fewer'],
      default: ''
    },
    logo: { type: String, default: '' },
    regions: {
      type: [String],
      default: []
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [20, 'Phone number is too long'],
      default: ''
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: value => !value || validator.isEmail(value),
        message: 'Please enter a valid email address'
      },
      default: ''
    },
    website: {
      type: String,
      trim: true,
      maxlength: [200, 'Link is too long'],
      default: ''
    },
    tradeLicenseNumber: {
      type: String,
      trim: true,
      maxlength: [60, 'Trade license number is too long'],
      default: ''
    },

    // Master admin controls
    status: {
      type: String,
      enum: ['active', 'suspended', 'deactivated'],
      default: 'active'
    },
    statusReason: { type: String, trim: true, maxlength: 500, default: '' },
    statusUntil: Date,
    statusChangedAt: Date,
    statusChangedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },

    categories: [{ type: mongoose.Schema.ObjectId, ref: 'VendorCategory' }],

    // Percent of each booking Plezar keeps. Empty means the platform default applies.
    commissionRate: { type: Number, min: [0, 'Commission cannot be negative'], max: [100, 'Commission cannot be more than 100%'], default: null },

    contract: {
      status: { type: String, enum: ['none', 'draft', 'sent', 'signed', 'terminated'], default: 'none' },
      version: { type: String, trim: true, maxlength: 20, default: '' },
      startDate: Date,
      endDate: Date,
      agreedCommission: { type: Number, min: 0, max: 100 },
      terms: { type: String, trim: true, maxlength: 4000, default: '' },
      signedBy: { type: String, trim: true, maxlength: 100, default: '' },
      signedAt: Date,
      // The signed agreement, stored privately and served only through an authenticated route
      document: {
        file: { type: String, select: false },
        originalName: String,
        mimeType: String,
        uploadedAt: Date
      },
      updatedAt: Date,
      updatedBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
    },
    verified: { type: Boolean, default: false },
    verification: {
      status: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none'
      },
      documents: { type: [documentSchema], default: [] },
      note: { type: String, trim: true, maxlength: 500, default: '' },
      submittedAt: Date,
      reviewedAt: Date,
      reviewedBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
    },

    sourceLead: { type: mongoose.Schema.ObjectId, ref: 'AgentLead' },
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  {
    timestamps: true
  }
);

agencySchema.index({ status: 1, 'verification.status': 1 });

const Agency = mongoose.model('Agency', agencySchema);
module.exports = Agency;
