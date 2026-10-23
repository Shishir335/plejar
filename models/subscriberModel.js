const mongoose = require('mongoose');
const validator = require('validator');

const subscriberSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Please provide your email address'],
      unique: true,
      lowercase: true,
      trim: true,
      validate: [validator.isEmail, 'Please provide a valid email address']
    },
    source: {
      type: String,
      default: 'newsletter',
      trim: true
    },
    status: {
      type: String,
      enum: ['active', 'unsubscribed'],
      default: 'active'
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

// Unique index is already handled by unique: true on the email field.


const Subscriber = mongoose.model('Subscriber', subscriberSchema);
module.exports = Subscriber;
