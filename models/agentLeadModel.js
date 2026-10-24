const crypto = require('crypto');
const mongoose = require('mongoose');
const validator = require('validator');

// A tour agency's membership application, sent from the website and reviewed by the master admin.
// (Older records from the first contact form have no documents or reference; they still list and work.)

const DOCUMENT_KINDS = ['trade_license', 'nid', 'tourism_license', 'other'];
const STATUSES = ['new', 'reviewing', 'needs_info', 'approved', 'rejected', 'contacted', 'archived'];
const TEAM_SIZES = ['1', '2-5', '6-15', '16+'];

const documentSchema = new mongoose.Schema({
  kind: { type: String, enum: DOCUMENT_KINDS, required: true },
  // Stored outside /public; served only through an authenticated admin route
  file: { type: String, required: true, select: false },
  originalName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now }
});

// The back-and-forth between our team and the applicant (requests for more information and replies)
const messageSchema = new mongoose.Schema({
  from: { type: String, enum: ['admin', 'applicant'], required: true },
  text: { type: String, trim: true, maxlength: 2000, required: true },
  by: { type: mongoose.Schema.ObjectId, ref: 'User' },
  byName: { type: String, default: '' },
  at: { type: Date, default: Date.now }
});

const agentLeadSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, sparse: true },

    // The agency
    agencyName: {
      type: String,
      required: [true, 'Please enter your agency name'],
      trim: true,
      maxlength: [120, 'Agency name must be 120 characters or fewer']
    },
    tradeLicenseNumber: { type: String, trim: true, maxlength: [60, 'Trade license number is too long'], default: '' },
    yearStarted: {
      type: Number,
      min: [1950, 'Enter the year your agency started'],
      max: [2100, 'Enter the year your agency started']
    },
    teamSize: { type: String, enum: { values: TEAM_SIZES, message: 'Choose a team size' } },
    officeAddress: { type: String, trim: true, maxlength: [300, 'Address must be 300 characters or fewer'], default: '' },
    district: { type: String, trim: true, maxlength: [60, 'District is too long'], default: '' },
    regions: {
      type: String,
      trim: true,
      maxlength: [200, 'Keep the list of places under 200 characters'],
      default: ''
    },
    categories: [{ type: mongoose.Schema.ObjectId, ref: 'VendorCategory' }],
    website: {
      type: String,
      trim: true,
      maxlength: [200, 'Link is too long'],
      default: ''
    },
    about: { type: String, trim: true, maxlength: [1500, 'Keep the description under 1500 characters'], default: '' },

    // The person applying (becomes the agency owner when approved)
    contactName: {
      type: String,
      required: [true, 'Please enter your name'],
      trim: true,
      maxlength: [80, 'Name must be 80 characters or fewer']
    },
    contactRole: { type: String, trim: true, maxlength: [60, 'Role is too long'], default: '' },
    phone: {
      type: String,
      required: [true, 'Please enter a phone number'],
      trim: true,
      maxlength: [20, 'Phone number is too long']
    },
    email: {
      type: String,
      required: [true, 'Please enter your email address'],
      lowercase: true,
      trim: true,
      validate: [validator.isEmail, 'Please enter a valid email address']
    },
    message: {
      type: String,
      trim: true,
      maxlength: [1000, 'Message must be 1000 characters or fewer'],
      default: ''
    },

    documents: { type: [documentSchema], default: [] },
    agreedToTerms: { type: Boolean, default: false },
    agreedAt: Date,

    // Review
    status: { type: String, enum: STATUSES, default: 'new' },
    messages: { type: [messageSchema], default: [] },
    // Set when the applicant replies, cleared when an admin opens the application
    unreadReply: { type: Boolean, default: false },
    internalNote: { type: String, trim: true, maxlength: 2000, default: '' },
    rejectedReason: { type: String, trim: true, maxlength: 1000, default: '' },
    decidedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    decidedAt: Date,
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency' },

    ipAddress: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

agentLeadSchema.index({ status: 1, createdAt: -1 });
agentLeadSchema.index({ email: 1 });

// Short, unambiguous reference the applicant can quote, e.g. PLZ-7KQ2M9
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
agentLeadSchema.statics.newReference = () => {
  const bytes = crypto.randomBytes(6);
  return `PLZ-${Array.from(bytes, b => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;
};

agentLeadSchema.pre('save', function (next) {
  if (this.isNew && !this.reference) this.reference = this.constructor.newReference();
  next();
});

const AgentLead = mongoose.model('AgentLead', agentLeadSchema);
AgentLead.DOCUMENT_KINDS = DOCUMENT_KINDS;
AgentLead.STATUSES = STATUSES;
AgentLead.TEAM_SIZES = TEAM_SIZES;
module.exports = AgentLead;
