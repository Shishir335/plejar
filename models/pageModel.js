const mongoose = require('mongoose');

// Text pages in the app's menu (About App, Privacy Policy, Terms & Conditions), written in the admin panel
const PAGES = [
  { key: 'about', title: 'About App' },
  { key: 'privacy', title: 'Privacy Policy' },
  { key: 'terms', title: 'Term & Condition' }
];

const pageSchema = new mongoose.Schema(
  {
    key: { type: String, enum: PAGES.map(p => p.key), required: true, unique: true },
    title: { type: String, trim: true, maxlength: 80, required: true },
    // Plain text; each line is a paragraph
    body: { type: String, trim: true, maxlength: [50000, 'Keep the page under 50,000 characters'], default: '' },
    published: { type: Boolean, default: false },
    // Changes when the text is edited, so the app can tell travelers the terms changed
    version: { type: Number, default: 0 },
    publishedAt: Date,
    updatedBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

const Page = mongoose.model('Page', pageSchema);
Page.PAGES = PAGES;
module.exports = Page;
