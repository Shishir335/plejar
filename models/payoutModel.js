const mongoose = require('mongoose');

// Money Plejar sends to a vendor from its earnings
const payoutSchema = new mongoose.Schema(
  {
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', required: true, index: true },
    amount: { type: Number, required: true, min: [1, 'Amount must be at least ৳1'] },
    method: { type: String, enum: ['bkash', 'nagad', 'rocket', 'bank'], required: [true, 'Choose how the money is sent'] },
    account: { type: String, required: [true, 'Enter the account or mobile number'], trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 300, default: '' },

    status: { type: String, enum: ['pending', 'paid', 'rejected'], default: 'pending', index: true },
    source: { type: String, enum: ['vendor', 'admin'], default: 'admin' }, // who started it
    reference: { type: String, trim: true, maxlength: 120, default: '' }, // payment transaction ID once sent
    rejectedReason: { type: String, trim: true, maxlength: 300, default: '' },
    requestedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    decidedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    paidAt: Date,
    decidedAt: Date
  },
  { timestamps: true }
);

payoutSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Payout', payoutSchema);
