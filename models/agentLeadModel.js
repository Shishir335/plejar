const mongoose = require('mongoose');
const validator = require('validator');

const agentLeadSchema = new mongoose.Schema(
  {
    agencyName: {
      type: String,
      required: [true, 'Please enter your agency name'],
      trim: true,
      maxlength: [120, 'Agency name must be 120 characters or fewer']
    },
    contactName: {
      type: String,
      required: [true, 'Please enter your name'],
      trim: true,
      maxlength: [80, 'Name must be 80 characters or fewer']
    },
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
    regions: {
      type: String,
      trim: true,
      maxlength: [200, 'Keep the list of places under 200 characters'],
      default: ''
    },
    website: {
      type: String,
      trim: true,
      maxlength: [200, 'Link is too long'],
      default: ''
    },
    message: {
      type: String,
      trim: true,
      maxlength: [1000, 'Message must be 1000 characters or fewer'],
      default: ''
    },
    status: {
      type: String,
      enum: ['new', 'contacted', 'archived'],
      default: 'new'
    },
    ipAddress: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

const AgentLead = mongoose.model('AgentLead', agentLeadSchema);
module.exports = AgentLead;
