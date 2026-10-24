const mongoose = require('mongoose');

// A post from a vendor to travelers: news, offers, trip updates. Published ones show on the agency's page in the app.
const announcementSchema = new mongoose.Schema(
  {
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency', required: true, index: true },
    title: {
      type: String,
      required: [true, 'Give the announcement a title'],
      trim: true,
      maxlength: [120, 'Title must be 120 characters or fewer']
    },
    body: {
      type: String,
      required: [true, 'Write the announcement'],
      trim: true,
      maxlength: [3000, 'Keep the announcement under 3000 characters']
    },
    // Optional tour event the announcement is about
    event: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    pinned: { type: Boolean, default: false },
    publishedAt: Date,
    // Set once travelers were notified, so publishing again doesn't notify twice
    notifiedAt: Date,
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

announcementSchema.index({ status: 1, publishedAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
