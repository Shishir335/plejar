const mongoose = require('mongoose');

// A comment on a post. Replies point at the top-level comment (parent), like Facebook's threads;
// replyTo names the person being answered so the app can show "@Rina".
const commentSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.ObjectId, ref: 'Post', required: true },
    author: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    // A staff member answering on their agency's wall: shown as the agency, not the person
    asAgency: { type: mongoose.Schema.ObjectId, ref: 'Agency' },
    parent: { type: mongoose.Schema.ObjectId, ref: 'Comment', default: null },
    replyTo: { type: mongoose.Schema.ObjectId, ref: 'User' },
    text: { type: String, trim: true, required: [true, 'Write a comment'], maxlength: [2000, 'Keep the comment under 2000 characters'] },
    reactionCount: { type: Number, default: 0 },
    replyCount: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'hidden', 'removed'], default: 'active' },
    reportCount: { type: Number, default: 0 },
    editedAt: Date
  },
  { timestamps: true }
);

commentSchema.index({ post: 1, parent: 1, createdAt: 1 });
commentSchema.index({ author: 1, createdAt: -1 });

module.exports = mongoose.model('Comment', commentSchema);
