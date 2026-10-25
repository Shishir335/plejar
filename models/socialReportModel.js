const mongoose = require('mongoose');

const REASONS = ['spam', 'harassment', 'hate', 'nudity', 'violence', 'false_information', 'scam', 'other'];

// A traveler reporting a post, a comment or a person to Plezar's team
const socialReportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['post', 'comment', 'user'], required: true },
    target: { type: mongoose.Schema.ObjectId, required: true },
    // The author of the reported post or comment (or the reported person)
    targetUser: { type: mongoose.Schema.ObjectId, ref: 'User' },
    reason: { type: String, enum: REASONS, required: [true, 'Choose a reason'] },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: ['open', 'action_taken', 'dismissed'], default: 'open' },
    resolution: { type: String, trim: true, maxlength: 500, default: '' },
    resolvedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    resolvedAt: Date
  },
  { timestamps: true }
);

// One open report per person per item
socialReportSchema.index({ reporter: 1, targetType: 1, target: 1 }, { unique: true });
socialReportSchema.index({ status: 1, createdAt: -1 });

const SocialReport = mongoose.model('SocialReport', socialReportSchema);
SocialReport.REASONS = REASONS;
module.exports = SocialReport;
