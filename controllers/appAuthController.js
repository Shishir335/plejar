const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/userModel');
const Otp = require('../models/otpModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Email = require('../utils/email');
const { sendSms, smsConfigured } = require('../utils/sms');
const { recordLogin } = require('../utils/activity');
const { photoURL } = require('../utils/social');
const { saveProfileImage, removeProfileImage } = require('../utils/userImages');
const { profileProblems, signupProblems, passwordProblems, normalizePhone, readPersonName, readDateOfBirth } = require('../utils/registration');
const { blockedReason, signToken } = require('./authController');
const { rolesOf, hasRole, addRole, roleFilter } = require('../utils/roles');
const { findReferrer, applyReferral } = require('../utils/referrals');

// Sign-up, sign-in and password recovery for the traveler app (/api/v1/auth)

const CODE_LIFETIME = 10 * 60 * 1000;
const RESEND_AFTER = 60 * 1000;
const MAX_CODES_PER_HOUR = 5;
const MAX_TRIES = 5;
const RESET_LIFETIME = 15 * 60 * 1000;

const sha256 = text => crypto.createHash('sha256').update(String(text)).digest('hex');
const sameHash = (a, b) => a && b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ymd = d => (d ? d.toISOString().slice(0, 10) : null);

// The signed-in traveler as the app stores it
const appUserView = user => ({
  _id: user._id,
  firstName: user.firstName || '',
  lastName: user.lastName || '',
  name: user.name,
  email: user.email || null,
  phone: user.phone || null,
  dateOfBirth: ymd(user.dateOfBirth),
  photoUrl: photoURL(user.photo),
  role: user.role,
  roles: rolesOf(user),
  authProvider: user.authProvider,
  profileComplete: Boolean(user.firstName && user.lastName && user.dateOfBirth),
  createdAt: user.createdAt || user._id.getTimestamp()
});
exports.appUserView = appUserView;

const sendSession = (res, status, user, message) => {
  res.status(status).json({ status: 'success', ...(message ? { message } : {}), token: signToken(user._id), data: { user: appUserView(user) } });
};

const fieldErrors = (res, errors) => res.status(400).json({ status: 'fail', message: Object.values(errors)[0], errors });

// Email or phone from a request: { email } or { phone }, or { identifier } that can be either
const readContact = b => {
  const raw = String(b.identifier || b.email || b.phone || '').trim();
  const isEmail = b.email !== undefined || (b.identifier !== undefined && raw.includes('@'));
  if (isEmail) return raw ? { channel: 'email', value: raw.toLowerCase() } : { error: 'Enter your email address.' };
  const phone = normalizePhone(raw);
  if (!raw) return { error: 'Enter your email or mobile number.' };
  return phone ? { channel: 'phone', value: phone } : { error: 'Enter a Bangladeshi mobile number, for example 01712345678.' };
};

// By email: any account (vendors and staff can use the app as travelers too).
// By phone: traveler accounts only, as other accounts' phone numbers aren't unique.
const findTraveler = ({ channel, value }, { withPassword = false, includeInactive = false } = {}) => {
  const q = User.findOne(channel === 'email' ? { email: value } : { $and: [{ phone: value }, roleFilter('user')] });
  if (withPassword) q.select('+password');
  if (includeInactive) q.setOptions({ includeInactive: true });
  return q;
};

// ---------- Sign up ----------

/**
 * POST /auth/register (JSON, or multipart with an optional "photo")
 * email and/or phone, password, confirmPassword; dateOfBirth (YYYY-MM-DD), firstName and lastName
 * may come now or in /auth/complete-profile (user.profileComplete says if that step is needed).
 */
exports.register = catchAsync(async (req, res) => {
  const b = req.body;
  const errors = signupProblems(b);
  const email = String(b.email || '').trim().toLowerCase();
  const phone = normalizePhone(b.phone);
  if (!errors.email && email && await User.exists({ email }).setOptions({ includeInactive: true })) {
    errors.email = 'An account with this email already exists. Log in instead.';
  }
  if (!errors.phone && phone && await User.exists({ $and: [{ phone }, roleFilter('user')] }).setOptions({ includeInactive: true })) {
    errors.phone = 'An account with this mobile number already exists. Log in instead.';
  }
  // Optional code from a friend's Refer Friends link
  const referrer = String(b.referralCode || '').trim() ? await findReferrer(b.referralCode) : null;
  if (String(b.referralCode || '').trim() && !referrer) errors.referralCode = "This referral code doesn't exist. Check it or leave it empty.";
  if (Object.keys(errors).length) return fieldErrors(res, errors);

  const fields = {
    // Left out when not sent, so phone-only accounts don't collide on the unique email index
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(String(b.dateOfBirth || '').trim() ? { dateOfBirth: readDateOfBirth(b.dateOfBirth) } : {}),
    password: b.password,
    confirmPassword: b.confirmPassword,
    role: 'user',
    authProvider: 'local'
  };
  if (String(b.firstName || '').trim()) fields.firstName = readPersonName(b.firstName, 'first name');
  if (String(b.lastName || '').trim()) fields.lastName = readPersonName(b.lastName, 'last name');
  if (!fields.firstName && !fields.lastName) fields.name = 'Plezar traveler';
  const user = await User.create(fields);
  const welcomePoints = await applyReferral(user, referrer);

  // The photo needs the new account's id for its file name; a bad photo doesn't undo the sign-up
  let photoWarning;
  if (req.file) {
    try {
      user.photo = await saveProfileImage(req.file, user._id, 'user');
      await user.save({ validateBeforeSave: false });
    } catch (err) {
      photoWarning = "Your account is ready, but the photo couldn't be used. Add one from Settings.";
    }
  }

  // Phone-only sign-ups have no address to welcome
  if (user.email) {
    try {
      await new Email(user, `${req.protocol}://${req.get('host')}/`).sendWelcome();
    } catch (mailErr) {
      console.warn('[MAIL WARNING] Welcome email deferred:', mailErr.message);
    }
  }

  await recordLogin(req, { user, email, success: true, reason: 'signup' });
  const welcome = user.firstName ? `Welcome to Plezar, ${user.firstName}!` : 'Your account is ready.';
  sendSession(res, 201, user, photoWarning || (welcomePoints ? `${welcome} You got ${welcomePoints.toLocaleString('en-US')} welcome points.` : welcome));
});

// GET /auth/check?email= or ?phone= — is this email or number free for a new account?
exports.checkAvailability = catchAsync(async (req, res) => {
  const contact = readContact(req.query);
  if (contact.error) return fieldErrors(res, { [req.query.phone !== undefined ? 'phone' : 'email']: contact.error });
  if (contact.channel === 'email' && signupProblems({ email: contact.value }).email) {
    return fieldErrors(res, { email: 'Enter a valid email address, for example rahim@gmail.com.' });
  }
  const taken = Boolean(await findTraveler(contact, { includeInactive: true }).select('_id'));
  const label = contact.channel === 'email' ? 'email' : 'mobile number';
  res.status(200).json({
    status: 'success',
    ...(taken ? { message: `An account with this ${label} already exists. Log in instead.` } : {}),
    data: { [contact.channel]: contact.value, available: !taken }
  });
});

/**
 * POST /auth/complete-profile (multipart) firstName, lastName, optional photo — the step after
 * sign-up. dateOfBirth is required only for accounts that don't have one yet (Google sign-ups).
 */
exports.completeProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id);
  const errors = profileProblems(req.body, { required: true, requireDateOfBirth: !user.dateOfBirth });
  if (Object.keys(errors).length) return fieldErrors(res, errors);
  user.firstName = readPersonName(req.body.firstName, 'first name');
  user.lastName = readPersonName(req.body.lastName, 'last name');
  if (String(req.body.dateOfBirth || '').trim()) user.dateOfBirth = readDateOfBirth(req.body.dateOfBirth);
  const oldPhoto = user.photo;
  if (req.file) user.photo = await saveProfileImage(req.file, user._id, 'user');
  await user.save({ validateBeforeSave: false });
  if (user.photo !== oldPhoto) await removeProfileImage(oldPhoto);
  res.status(200).json({ status: 'success', message: `You're all set, ${user.firstName}!`, data: { user: appUserView(user) } });
});

// ---------- Sign in ----------

// POST /auth/login { email | phone | identifier, password }
exports.login = catchAsync(async (req, res, next) => {
  const contact = readContact(req.body);
  const password = String(req.body.password || '');
  const errors = {};
  if (contact.error) errors[contact.channel || (req.body.phone !== undefined ? 'phone' : 'email')] = contact.error;
  if (!password) errors.password = 'Enter your password.';
  if (Object.keys(errors).length) return fieldErrors(res, errors);

  const user = await findTraveler(contact, { withPassword: true });
  const wrong = contact.channel === 'email' ? 'Incorrect email or password.' : 'Incorrect mobile number or password.';
  if (!user || !user.password || !(await user.correctPassword(password, user.password))) {
    await recordLogin(req, { user, email: contact.value, success: false, reason: user ? 'wrong_password' : 'unknown_email' });
    if (user && !user.password && user.authProvider === 'google') return next(new AppError('This account uses Google. Tap "Continue with Google", or set a password with "Forgot password".', 401));
    return next(new AppError(wrong, 401));
  }
  const blocked = await blockedReason(user);
  if (blocked) {
    await recordLogin(req, { user, email: contact.value, success: false, reason: `blocked_${user.deletedAt ? 'deleted' : user.status}` });
    return next(new AppError(blocked, 403));
  }

  // A vendor or staff account signing in to the app for the first time becomes a traveler too
  const joined = !hasRole(user, 'user');
  if (joined) addRole(user, 'user');
  user.lastLoginAt = new Date();
  user.loginCount = (user.loginCount || 0) + 1;
  await user.save({ validateBeforeSave: false });
  await recordLogin(req, { user, email: contact.value, success: true });
  sendSession(res, 200, user, joined ? 'Welcome to the Plezar app! Your account now works here too.' : undefined);
});

const googleClient = new OAuth2Client();
const googleAudiences = () => [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_IOS_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID].filter(Boolean);

// POST /auth/google { idToken } from google_sign_in in the app
exports.google = catchAsync(async (req, res, next) => {
  const idToken = String(req.body.idToken || req.body.credential || '');
  if (!idToken) return next(new AppError('Google sign-in did not finish. Try again.', 400));
  if (!googleAudiences().length) return next(new AppError('Google sign-in is not set up on the server yet.', 503));
  let payload;
  try {
    payload = (await googleClient.verifyIdToken({ idToken, audience: googleAudiences() })).getPayload();
  } catch (err) {
    return next(new AppError('Google sign-in could not be confirmed. Try again.', 401));
  }
  if (!payload.email || payload.email_verified === false) return next(new AppError('Your Google account has no confirmed email.', 400));

  const email = payload.email.toLowerCase();
  let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] });
  let created = false;
  if (user) {
    const blocked = await blockedReason(user);
    if (blocked) return next(new AppError(blocked, 403));
    if (!hasRole(user, 'user')) addRole(user, 'user');
    if (!user.googleId) user.googleId = payload.sub;
    if (!user.firstName && payload.given_name) user.firstName = payload.given_name.slice(0, 30);
    if (!user.lastName && payload.family_name) user.lastName = payload.family_name.slice(0, 30);
    if (payload.picture && (!user.photo || user.photo === 'profile.png')) user.photo = payload.picture;
  } else {
    created = true;
    user = new User({
      email,
      googleId: payload.sub,
      authProvider: 'google',
      role: 'user',
      firstName: (payload.given_name || '').slice(0, 30),
      lastName: (payload.family_name || '').slice(0, 30),
      name: payload.name || 'Plezar traveler',
      photo: payload.picture || 'profile.png'
    });
  }
  user.lastLoginAt = new Date();
  user.loginCount = (user.loginCount || 0) + 1;
  await user.save({ validateBeforeSave: false });
  await recordLogin(req, { user, email, success: true, method: 'google', reason: created ? 'signup' : '' });
  sendSession(res, created ? 201 : 200, user, created ? 'Your account is ready.' : undefined);
});

exports.me = (req, res) => res.status(200).json({ status: 'success', data: { user: appUserView(req.user) } });

// Tokens live on the phone; signing out there is enough. This also clears the website cookie and prunes device FCM tokens.
exports.logout = async (req, res) => {
  try {
    const fcmToken = req.body?.fcmToken || req.body?.token || req.query?.fcmToken;
    if (fcmToken) {
      const { removeUserToken } = require('../utils/pushNotification');
      if (req.user && req.user._id) {
        await removeUserToken(req.user._id, fcmToken);
      } else {
        await User.updateMany(
          { 'fcmTokens.token': String(fcmToken).trim() },
          { $pull: { fcmTokens: { token: String(fcmToken).trim() } } }
        );
      }
    }
  } catch (_) {
    // Non-blocking cleanup
  }

  const isSecure = process.env.NODE_ENV === 'production' || 
      Boolean(req && (req.secure || req.headers['x-forwarded-proto'] === 'https'));

  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 1000),
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/'
  });

  res.status(200).json({ status: 'success', message: 'Logged out successfully.' });
};

// ---------- Forgot password: code, verify, new password ----------

const mask = ({ channel, value }) => {
  if (channel === 'phone') return `${value.slice(0, 3)}*****${value.slice(-3)}`;
  const [local, domain] = value.split('@');
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 3))}@${domain}`;
};

// While developing without mail or SMS set up, the code is returned so the app can be tested
const exposeDevCode = channel => process.env.NODE_ENV === 'development' && !(channel === 'email' ? Email.isConfigured() : smsConfigured());

const deliverCode = async (user, contact, code, req) => {
  if (contact.channel === 'email') {
    if (!Email.isConfigured()) {
      console.log(`[EMAIL NOT SENT: no mail account configured] code ${code} for ${contact.value}`);
      return false;
    }
    await new Email(user, `${req.protocol}://${req.get('host')}/`, { code }).sendPasswordCode();
    return true;
  }
  const { delivered } = await sendSms(contact.value, `${code} is your Plezar security code. It works for 10 minutes. Don't share it with anyone.`);
  return delivered;
};

// POST /auth/forgot-password { email | phone } — sends a 4-digit code (also used for "Resend OTP")
exports.forgotPassword = catchAsync(async (req, res, next) => {
  const contact = readContact(req.body);
  if (contact.error) return fieldErrors(res, { [req.body.phone !== undefined ? 'phone' : 'email']: contact.error });
  const user = await findTraveler(contact);
  const label = contact.channel === 'email' ? 'email' : 'mobile number';
  if (!user) return next(new AppError(`We couldn't find an account with this ${label}.`, 404));
  const blocked = await blockedReason(user);
  if (blocked) return next(new AppError(blocked, 403));

  const recent = await Otp.find({ purpose: 'password_reset', destination: contact.value, createdAt: { $gt: new Date(Date.now() - 3600 * 1000) } }).sort({ createdAt: -1 }).lean();
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < RESEND_AFTER) {
    const wait = Math.ceil((RESEND_AFTER - (Date.now() - recent[0].createdAt.getTime())) / 1000);
    return next(new AppError(`Please wait ${wait} seconds before asking for another code.`, 429));
  }
  if (recent.length >= MAX_CODES_PER_HOUR) return next(new AppError('Too many codes asked for. Try again in an hour.', 429));
  if (!exposeDevCode(contact.channel) && !(contact.channel === 'email' ? Email.isConfigured() : smsConfigured())) {
    return next(new AppError(`Sending codes by ${contact.channel === 'email' ? 'email' : 'SMS'} isn't set up yet. Contact Plezar support.`, 503));
  }

  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  // Asking again replaces any earlier code
  await Otp.updateMany({ purpose: 'password_reset', user: user._id, verifiedAt: null, usedAt: null }, { expiresAt: new Date() });
  const otp = await Otp.create({ purpose: 'password_reset', channel: contact.channel, destination: contact.value, user: user._id, codeHash: sha256(code), expiresAt: new Date(Date.now() + CODE_LIFETIME) });
  try {
    await deliverCode(user, contact, code, req);
  } catch (err) {
    await Otp.deleteOne({ _id: otp._id });
    console.error('[CODE NOT SENT]', err.message);
    return next(new AppError("We couldn't send the code right now. Try again in a minute.", 502));
  }

  res.status(200).json({
    status: 'success',
    message: `We sent a 4-digit code to ${mask(contact)}.`,
    data: {
      channel: contact.channel,
      sentTo: mask(contact),
      expiresInSeconds: CODE_LIFETIME / 1000,
      resendInSeconds: RESEND_AFTER / 1000,
      ...(exposeDevCode(contact.channel) ? { devCode: code } : {})
    }
  });
});

// POST /auth/verify-code { email | phone, code } — returns a resetToken for the new password screen
exports.verifyCode = catchAsync(async (req, res, next) => {
  const contact = readContact(req.body);
  if (contact.error) return fieldErrors(res, { [req.body.phone !== undefined ? 'phone' : 'email']: contact.error });
  const code = String(req.body.code || '').trim();
  if (!/^\d{4}$/.test(code)) return fieldErrors(res, { code: 'Enter the 4-digit code.' });

  const otp = await Otp.findOne({ purpose: 'password_reset', destination: contact.value, verifiedAt: null, usedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 }).select('+codeHash');
  if (!otp) return next(new AppError('This code has expired. Tap "Resend OTP" for a new one.', 400));
  if (otp.attempts >= MAX_TRIES) return next(new AppError('Too many wrong codes. Tap "Resend OTP" for a new one.', 429));
  if (!sameHash(otp.codeHash, sha256(code))) {
    otp.attempts += 1;
    await otp.save();
    const left = MAX_TRIES - otp.attempts;
    return next(new AppError(left ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Tap "Resend OTP" for a new one.', 400));
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  otp.verifiedAt = new Date();
  otp.resetTokenHash = sha256(resetToken);
  otp.resetTokenExpiresAt = new Date(Date.now() + RESET_LIFETIME);
  await otp.save();
  res.status(200).json({ status: 'success', message: 'Code confirmed. Choose a new password.', data: { resetToken, expiresInSeconds: RESET_LIFETIME / 1000 } });
});

// POST /auth/reset-password { resetToken, password, confirmPassword } — sets it and signs the traveler in
exports.resetPassword = catchAsync(async (req, res, next) => {
  const errors = {};
  passwordProblems(req.body, errors);
  if (Object.keys(errors).length) return fieldErrors(res, errors);
  const token = String(req.body.resetToken || '');
  const otp = token ? await Otp.findOne({ resetTokenHash: sha256(token), usedAt: null, resetTokenExpiresAt: { $gt: new Date() } }) : null;
  if (!otp) return next(new AppError('This reset has expired. Start again from "Forgot password".', 400));

  const user = await User.findById(otp.user).select('+password');
  if (!user) return next(new AppError('This account is no longer available.', 404));
  const blocked = await blockedReason(user);
  if (blocked) return next(new AppError(blocked, 403));

  user.password = req.body.password;
  user.confirmPassword = req.body.confirmPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  otp.usedAt = new Date();
  await otp.save();
  await recordLogin(req, { user, email: otp.destination, success: true, reason: 'password_reset' });
  sendSession(res, 200, user, 'Your password is changed.');
});
