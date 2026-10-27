const mongoose = require('mongoose');

// A traveler's post in the app feed (text, photos or a video, optionally tagged with a place, an agency or a tour)
const mediaSchema = new mongoose.Schema({
  type: { type: String, enum: ['image', 'video'], required: true },
  url: { type: String, required: true },
  width: Number,
  height: Number,
  size: Number
}, { _id: false });

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.ObjectId, ref: 'User', required: true, index: true },
    // 'share' posts point at the original through sharedFrom; 'live' is reserved for streaming later
    kind: { type: String, enum: ['post', 'share', 'live'], default: 'post' },
    text: { type: String, trim: true, maxlength: [5000, 'Keep the post under 5000 characters'], default: '' },
    media: { type: [mediaSchema], default: [] },
    sharedFrom: { type: mongoose.Schema.ObjectId, ref: 'Post' },

    // Tags
    place: { type: mongoose.Schema.ObjectId, ref: 'Destination' },
    placeName: { type: String, trim: true, maxlength: 120, default: '' },
    agency: { type: mongoose.Schema.ObjectId, ref: 'Agency' },
    event: { type: mongoose.Schema.ObjectId, ref: 'Package' },
    feeling: { type: String, trim: true, maxlength: 40, default: '' },

    // Who can see it and comment on it
    audience: { type: String, enum: ['public', 'followers', 'private'], default: 'public' },
    allowComments: { type: Boolean, default: true },

    // Counters kept up to date as people react, comment and share
    reactionCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },

    // Moderation: 'hidden' by Plejar after a report, 'removed' by the author or Plejar
    status: { type: String, enum: ['active', 'hidden', 'removed'], default: 'active' },
    moderationNote: { type: String, trim: true, maxlength: 500, default: '' },
    moderatedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    moderatedAt: Date,
    reportCount: { type: Number, default: 0 },
    editedAt: Date
  },
  { timestamps: true }
);

postSchema.index({ status: 1, createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ place: 1, createdAt: -1 });
postSchema.index({ agency: 1, createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);
