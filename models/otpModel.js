const mongoose = require('mongoose');

/**
 * One-time security codes sent by email or SMS (forgot password in the app).
 * Only hashes are stored. A verified code is swapped for a short-lived reset token.
 */
const otpSchema = new mongoose.Schema(
  {
    purpose: { type: String, enum: ['password_reset', 'verify_email', 'verify_phone', 'delete_account'], required: true },
    channel: { type: String, enum: ['email', 'phone'], required: true },
    destination: { type: String, required: true }, // the email or 01XXXXXXXXX it was sent to
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    verifiedAt: Date,
    resetTokenHash: { type: String, select: false },
    resetTokenExpiresAt: Date,
    usedAt: Date
  },
  { timestamps: true }
);

otpSchema.index({ purpose: 1, destination: 1, createdAt: -1 });
otpSchema.index({ resetTokenHash: 1 }, { sparse: true });
// Old codes clean themselves up a day after they expire
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 });

module.exports = mongoose.model('Otp', otpSchema);
