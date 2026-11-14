// Identity verification rules shared by the traveler's steps, the submission and the booking check.
const { hasRole } = require('./roles');

// Documents that prove who the traveler is (nid, passport and driving_license come from older app builds)
const ID_KINDS = ['nid_front', 'nid_back', 'birth_certificate', 'nid', 'passport', 'driving_license'];
// The face check: looking straight at the camera, then turning left and right
const FACE_KINDS = ['selfie', 'face_left', 'face_right'];

const ADULT_AGE = 18;

// Whole years on `at`, or null with no date of birth
const ageOn = (dateOfBirth, at = new Date()) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  let age = at.getFullYear() - dob.getFullYear();
  const m = at.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) age -= 1;
  return age;
};

// Which ID the traveler sends: an NID (front and back) from 18, a birth certificate below 18
const idOptions = age => {
  if (age == null) return [];
  return age >= ADULT_AGE ? ['nid'] : ['birth_certificate'];
};

// On unless ID_VERIFICATION_REQUIRED=false
const verificationRequired = () => String(process.env.ID_VERIFICATION_REQUIRED || '').toLowerCase() !== 'false';

const canBook = user => !verificationRequired() || (user.verification && user.verification.status === 'approved') || hasRole(user, 'admin', 'dev');

const blockedMessage = user => {
  const v = user.verification || {};
  if (v.status === 'pending') return 'Your identity is being reviewed. You can book as soon as Plejar approves it.';
  if (v.status === 'rejected') {
    return `Your identity verification was not approved${v.note ? `: ${v.note}` : '.'} Please submit it again to book.`;
  }
  return 'Verify your identity before booking. It takes a minute: your NID or birth certificate and a quick face check.';
};

// Booking routes: travelers book only after an admin approves their ID and face photos
const requireVerifiedIdentity = (req, res, next) => {
  if (canBook(req.user)) return next();
  const v = req.user.verification || {};
  res.status(403).json({
    status: 'fail',
    code: 'verification_required',
    message: blockedMessage(req.user),
    data: { verificationStatus: v.status || 'none', note: v.status === 'rejected' ? v.note || '' : '' }
  });
};

module.exports = { ID_KINDS, FACE_KINDS, ADULT_AGE, ageOn, idOptions, verificationRequired, canBook, requireVerifiedIdentity };
