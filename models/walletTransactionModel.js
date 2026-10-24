const mongoose = require('mongoose');

// Every change to User.walletBalance is recorded here, so the balance can always be explained
const walletTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true, min: [0.01, 'Amount must be more than zero'] },
    balanceAfter: { type: Number, required: true },
    reason: {
      type: String,
      enum: ['topup', 'refund', 'booking', 'promo', 'adjustment'],
      default: 'adjustment'
    },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    booking: { type: mongoose.Schema.ObjectId, ref: 'Booking' },
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' } // set when an admin made the change
  },
  { timestamps: true }
);

walletTransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
