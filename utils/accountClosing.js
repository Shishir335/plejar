const User = require('../models/userModel');
const Wishlist = require('../models/wishlistModel');
const RecentView = require('../models/recentViewModel');
const TourSearch = require('../models/tourSearchModel');
const SavedPost = require('../models/savedPostModel');
const Follow = require('../models/followModel');
const LoginEvent = require('../models/loginEventModel');
const Otp = require('../models/otpModel');
const { removePrivateDocument } = require('./uploads');
const { removeProfileImage } = require('./userImages');
const { isTravelerOnly } = require('./roles');

/**
 * A traveler closing their own account (in the app, or from plejar.com/delete-account).
 *
 * Removed: name, contact details, photos, birth date, addresses, bio, ID documents and
 * face photos, saved tours, recent views and searches, saved posts, follows, sign-in history.
 * Kept, as the law asks: bookings, payments and reward-points records. They stay linked to
 * the closed account, which now shows as "Deleted user". The account can't sign in again.
 */

/** Why this account can't close itself, or null */
const closeProblem = user => {
  if (!user || user.active === false || user.deletedAt) return 'This account is already closed.';
  if (!isTravelerOnly(user)) return 'Staff and agency accounts are closed by Plejar. Contact support.';
  return null;
};

const closeAccount = async (userId, { reason = 'Closed by the traveler' } = {}) => {
  const user = await User.findById(userId).select('+verification.documents.file');
  const problem = closeProblem(user);
  if (problem) return { closed: false, problem };

  const photos = [user.photo, user.coverPhoto];
  const documents = user.verification.documents.map(d => d.file);

  user.set({
    name: 'Deleted user',
    firstName: '',
    lastName: '',
    photo: 'profile.png',
    coverPhoto: '',
    bio: '',
    hometown: '',
    occupation: '',
    gender: '',
    address: '',
    addresses: [],
    interests: [],
    fcmTokens: [],
    'verification.status': 'none',
    'verification.documents': [],
    'verification.note': '',
    active: false,
    deletedAt: new Date(),
    deletedBy: user._id,
    deletedReason: reason
  });
  for (const field of ['email', 'phone', 'dateOfBirth', 'googleId', 'referralCode', 'emailVerifiedAt', 'phoneVerifiedAt',
    'verification.liveness', 'passwordResetToken', 'passwordResetExpire', 'inviteToken']) {
    user.set(field, undefined);
  }
  await user.save({ validateBeforeSave: false });

  await Promise.all([
    ...photos.map(p => removeProfileImage(p).catch(() => {})),
    ...documents.map(f => removePrivateDocument(f).catch(() => {})),
    Wishlist.deleteMany({ user: user._id }),
    RecentView.deleteMany({ user: user._id }),
    TourSearch.deleteMany({ user: user._id }),
    SavedPost.deleteMany({ user: user._id }),
    Follow.deleteMany({ follower: user._id }),
    LoginEvent.deleteMany({ user: user._id }),
    Otp.deleteMany({ user: user._id })
  ]);
  return { closed: true, problem: null };
};

module.exports = { closeAccount, closeProblem };
