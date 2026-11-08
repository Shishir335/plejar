const crypto = require('crypto');
const mongoose = require('mongoose');
const validator = require('validator');

// A membership application from a tour agency or a hotel, sent from the website or the traveler app
// ("Travel Agency Application") and reviewed by the master admin. agencyName holds the business name either way.
// A hotel's application also carries what its draft listing starts from (hotel).
const { STAY_TYPES } = require('./hotelModel');
// (Older records from the first contact form have no documents or reference; they still list and work.)

const DOCUMENT_KINDS = ['trade_license', 'nid', 'tourism_license', 'insurance', 'tax_id', 'other'];

// Choices on the app's 3-step form, as { key: label }
const APP_OPTIONS = {
  businessTypes: {
    tour_operator: 'Tour operator',
    travel_agency: 'Travel agency',
    destination_management: 'Destination management company',
    online_travel_agency: 'Online travel agency',
    corporate_travel: 'Corporate travel',
    hotel_resort: 'Hotel or resort',
    transport: 'Transport provider',
    other: 'Other'
  },
  annualSales: { under_50k: 'Under $50,000', '50k_250k': '$50,000 - $250,000', '250k_1m': '$250,000 - $1 million', '1m_5m': '$1 - 5 million', over_5m: 'Over $5 million' },
  employees: { '1-5': '1 - 5', '6-20': '6 - 20', '21-50': '21 - 50', '51-200': '51 - 200', '200+': 'More than 200' },
  annualClients: { under_500: 'Under 500', '500_2000': '500 - 2,000', '2000_10000': '2,000 - 10,000', over_10000: 'Over 10,000' },
  specializations: {
    leisure: 'Leisure Travel',
    business: 'Business Travel',
    luxury: 'Luxury Travel',
    adventure: 'Adventure Travel',
    cruises: 'Cruises',
    group: 'Group Travel',
    honeymoon: 'Honeymoon & Romance',
    destination_weddings: 'Destination Weddings'
  },
  heardFrom: {
    social_media: 'Social media',
    search_engine: 'Google or another search engine',
    friend: 'A friend or colleague',
    plezar_app: 'The Plejar app',
    event: 'A travel fair or event',
    news: 'News or a blog',
    other: 'Other'
  }
};
const keysOf = group => Object.keys(APP_OPTIONS[group]);
const VENDOR_TYPES = ['agency', 'hotel'];
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
    source: { type: String, enum: ['website', 'app'], default: 'website' },
    // The traveler who applied from the app (they follow it in My Account)
    applicant: { type: mongoose.Schema.ObjectId, ref: 'User', index: true },
    vendorType: { type: String, enum: { values: VENDOR_TYPES, message: 'Choose a tour agency or a hotel' }, default: 'agency', index: true },
    hotel: {
      stayType: { type: String, enum: { values: [...STAY_TYPES, ''], message: 'Choose the kind of stay' }, default: '' },
      rooms: { type: Number, min: [1, 'Enter how many rooms you have'], max: [5000, 'Enter how many rooms you have'] },
      starRating: { type: Number, min: [1, 'Choose a star rating from 1 to 5'], max: [5, 'Choose a star rating from 1 to 5'] },
      pricePerNight: { type: Number, min: [0, 'The price cannot be negative'], max: [10000000, 'Check the price per night'] },
      checkIn: { type: String, trim: true, match: [/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a check-in time'], default: '' },
      checkOut: { type: String, trim: true, match: [/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a check-out time'], default: '' }
    },

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
    // From the app form: the full address and the kind of business
    businessType: { type: String, enum: { values: [...keysOf('businessTypes'), ''], message: 'Choose a business type' }, default: '' },
    city: { type: String, trim: true, maxlength: 80, default: '' },
    stateProvince: { type: String, trim: true, maxlength: 80, default: '' },
    postalCode: { type: String, trim: true, maxlength: 20, default: '' },
    country: { type: String, trim: true, maxlength: 60, default: 'Bangladesh' },
    business: {
      annualSales: { type: String, enum: [...keysOf('annualSales'), ''], default: '' },
      employees: { type: String, enum: [...keysOf('employees'), ''], default: '' },
      annualClients: { type: String, enum: [...keysOf('annualClients'), ''], default: '' },
      specializations: [{ type: String, enum: keysOf('specializations') }],
      partnerships: { type: String, trim: true, maxlength: 1000, default: '' },
      heardFrom: { type: String, enum: [...keysOf('heardFrom'), ''], default: '' }
    },
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
    // A hotel's draft listing, made when the application is accepted
    hotelListing: { type: mongoose.Schema.ObjectId, ref: 'Hotel' },

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
AgentLead.VENDOR_TYPES = VENDOR_TYPES;
AgentLead.TEAM_SIZES = TEAM_SIZES;
AgentLead.APP_OPTIONS = APP_OPTIONS;
module.exports = AgentLead;
