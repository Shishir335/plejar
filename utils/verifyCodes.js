const crypto = require('crypto');
const Otp = require('../models/otpModel');
const AppError = require('./appError');
const Email = require('./email');
const { sendSms, smsConfigured } = require('./sms');

// 4-digit codes that confirm a traveler's email or phone ("ID Verification" in the app).
// Same rules as the forgot-password codes: 10 minutes, a new one after 60 seconds, 5 an hour, 5 tries.

const CODE_LIFETIME = 10 * 60 * 1000;
const RESEND_AFTER = 60 * 1000;
const MAX_PER_HOUR = 5;
const MAX_TRIES = 5;

const sha256 = text => crypto.createHash('sha256').update(String(text)).digest('hex');
const sameHash = (a, b) => a && b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const configured = channel => (channel === 'email' ? Email.isConfigured() : smsConfigured());
// While developing without mail or SMS, the code comes back in the response so the app can be tested
const exposeDevCode = channel => process.env.NODE_ENV === 'development' && !configured(channel);

const mask = (channel, value) => {
  if (channel === 'phone') return `${value.slice(0, 3)}*****${value.slice(-3)}`;
  const [local, domain] = value.split('@');
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 3))}@${domain}`;
};

/** Send a code to the user's email or phone. Returns what the app shows. Throws AppError. */
const sendVerifyCode = async (user, channel, req) => {
  const purpose = channel === 'email' ? 'verify_email' : 'verify_phone';
  const destination = channel === 'email' ? user.email : user.phone;
  if (!destination) throw new AppError(channel === 'email' ? 'Add an email address to your profile first.' : 'Add a mobile number to your profile first.', 400);
  const recent = await Otp.find({ purpose, user: user._id, createdAt: { $gt: new Date(Date.now() - 3600 * 1000) } }).sort({ createdAt: -1 }).lean();
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < RESEND_AFTER) {
    throw new AppError(`Please wait ${Math.ceil((RESEND_AFTER - (Date.now() - recent[0].createdAt.getTime())) / 1000)} seconds before asking for another code.`, 429);
  }
  if (recent.length >= MAX_PER_HOUR) throw new AppError('Too many codes asked for. Try again in an hour.', 429);
  if (!exposeDevCode(channel) && !configured(channel)) throw new AppError(`Sending codes by ${channel === 'email' ? 'email' : 'SMS'} isn't set up yet. Contact Plejar support.`, 503);

  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  await Otp.updateMany({ purpose, user: user._id, verifiedAt: null }, { expiresAt: new Date() });
  const otp = await Otp.create({ purpose, channel, destination, user: user._id, codeHash: sha256(code), expiresAt: new Date(Date.now() + CODE_LIFETIME) });
  try {
    if (channel === 'email' && configured('email')) await new Email(user, `${req.protocol}://${req.get('host')}/`, { code }).sendVerifyCode();
    else if (channel === 'phone') await sendSms(destination, `${code} is your Plejar code to confirm this number. It works for 10 minutes.`);
  } catch (err) {
    await Otp.deleteOne({ _id: otp._id });
    console.error('[CODE NOT SENT]', err.message);
    throw new AppError("We couldn't send the code right now. Try again in a minute.", 502);
  }
  return {
    channel,
    sentTo: mask(channel, destination),
    expiresInSeconds: CODE_LIFETIME / 1000,
    resendInSeconds: RESEND_AFTER / 1000,
    ...(exposeDevCode(channel) ? { devCode: code } : {})
  };
};

/** Check a code. Returns true when right; throws AppError otherwise. */
const checkVerifyCode = async (user, channel, code) => {
  const purpose = channel === 'email' ? 'verify_email' : 'verify_phone';
  if (!/^\d{4}$/.test(String(code || ''))) throw new AppError('Enter the 4-digit code.', 400);
  const destination = channel === 'email' ? user.email : user.phone;
  const otp = await Otp.findOne({ purpose, user: user._id, destination, verifiedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).select('+codeHash');
  if (!otp) throw new AppError('This code has expired. Ask for a new one.', 400);
  if (otp.attempts >= MAX_TRIES) throw new AppError('Too many wrong codes. Ask for a new one.', 429);
  if (!sameHash(otp.codeHash, sha256(code))) {
    otp.attempts += 1;
    await otp.save();
    const left = MAX_TRIES - otp.attempts;
    throw new AppError(left ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.', 400);
  }
  otp.verifiedAt = new Date();
  otp.usedAt = new Date();
  await otp.save();
  return true;
};

module.exports = { sendVerifyCode, checkVerifyCode };
