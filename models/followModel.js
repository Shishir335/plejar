const mongoose = require('mongoose');

// A traveler following another traveler or a tour agency
const followSchema = new mongoose.Schema(
  {
    follower: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['user', 'agency'], required: true },
    target: { type: mongoose.Schema.ObjectId, required: true }
  },
  { timestamps: true }
);

followSchema.index({ follower: 1, targetType: 1, target: 1 }, { unique: true });
followSchema.index({ targetType: 1, target: 1, createdAt: -1 });

module.exports = mongoose.model('Follow', followSchema);
