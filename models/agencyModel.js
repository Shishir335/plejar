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
      enum: ['active', 'suspended'],
      default: 'active'
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
