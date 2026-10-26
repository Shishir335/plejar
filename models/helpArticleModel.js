const mongoose = require('mongoose');

// Help Center questions and answers, written by Plezar in the admin panel
const CATEGORIES = [
  { key: 'booking', label: 'Booking & Reservations', description: 'Find help with bookings & reservations' },
  { key: 'payments', label: 'Payment & Refunds', description: 'Find help with payment & refunds' },
  { key: 'vouchers', label: 'Vouchers & Rewards', description: 'Find help with vouchers & rewards' },
  { key: 'destinations', label: 'Destination', description: 'Find help with destinations' },
  { key: 'policies', label: 'Travel Policies', description: 'Find help with travel policies' },
  { key: 'account', label: 'Account & Safety', description: 'Find help with your account and safety' }
];

const helpArticleSchema = new mongoose.Schema(
  {
    category: { type: String, enum: { values: CATEGORIES.map(c => c.key), message: 'Choose a category' }, required: true },
    question: { type: String, required: [true, 'Write the question'], trim: true, maxlength: [200, 'Keep the question under 200 characters'] },
    answer: { type: String, required: [true, 'Write the answer'], trim: true, maxlength: [5000, 'Keep the answer under 5000 characters'] },
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
    helpfulYes: { type: Number, default: 0 },
    helpfulNo: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

helpArticleSchema.index({ category: 1, order: 1 });
helpArticleSchema.index({ question: 'text', answer: 'text' });

const HelpArticle = mongoose.model('HelpArticle', helpArticleSchema);
HelpArticle.CATEGORIES = CATEGORIES;
module.exports = HelpArticle;
