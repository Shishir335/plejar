const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.ObjectId, ref: 'User', required: true, index: true },
    // Who or what the complaint is about
    againstUser: { type: mongoose.Schema.ObjectId, ref: 'User', index: true },
    againstAgency: { type: mongoose.Schema.ObjectId, ref: 'Agency', index: true },
    booking: { type: mongoose.Schema.ObjectId, ref: 'Booking' },

    category: {
      type: String,
      enum: ['payment', 'behavior', 'safety', 'service_quality', 'fraud', 'help_request', 'other'],
      default: 'other'
    },
    subject: { type: String, required: [true, 'Please add a subject'], trim: true, maxlength: [150, 'Subject must be 150 characters or fewer'] },
    message: { type: String, required: [true, 'Please describe the problem'], trim: true, maxlength: [3000, 'Message must be 3000 characters or fewer'] },
    // Help requests from the app's Contact Support form: who to reply to, and the topic they typed
    contactName: { type: String, trim: true, maxlength: 80, default: '' },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 200, default: '' },
    topic: { type: String, trim: true, maxlength: 80, default: '' },

    status: { type: String, enum: ['open', 'in_review', 'resolved', 'dismissed'], default: 'open', index: true },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    resolution: { type: String, trim: true, maxlength: 1000, default: '' },
    internalNote: { type: String, trim: true, maxlength: 1000, default: '' },
    handledBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    resolvedAt: Date
  },
  { timestamps: true }
);

complaintSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Complaint', complaintSchema);
