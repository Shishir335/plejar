const crypto = require('crypto');
const Otp = require('../models/otpModel');
const Email = require('../utils/email');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { sendSms } = require('../utils/sms');
const { logActivity } = require('../utils/activity');
const { closeAccount, closeProblem } = require('../utils/accountClosing');
const { codeHelpers } = require('./appAuthController');

// plejar.com/delete-account: a traveler who can't open the app closes their account with
// a code sent to its email or mobile number. Answers are the same whether or not an account
// exists, so the page can't be used to find out who has one.

const { readContact, findTraveler, mask, exposeDevCode, fieldErrors, sha256, sameHash, CODE_LIFETIME, RESEND_AFTER, MAX_CODES_PER_HOUR, MAX_TRIES } = codeHelpers;
const PURPOSE = 'delete_account';

const sent = (res, contact, devCode) => res.status(200).json({
  status: 'success',
  message: `If a Plejar account uses ${mask(contact)}, we sent a 4-digit code to it.`,
  data: { sentTo: mask(contact), expiresInSeconds: CODE_LIFETIME / 1000, resendInSeconds: RESEND_AFTER / 1000, ...(devCode ? { devCode } : {}) }
});

// POST /api/v1/account-deletion/code { identifier }
exports.sendCode = catchAsync(async (req, res) => {
  const contact = readContact(req.body);
  if (contact.error) return fieldErrors(res, { identifier: contact.error });
  const user = await findTraveler(contact);
  if (!user || closeProblem(user)) return sent(res, contact);

  const recent = await Otp.find({ purpose: PURPOSE, destination: contact.value, createdAt: { $gt: new Date(Date.now() - 3600 * 1000) } }).sort({ createdAt: -1 }).lean();
  const tooSoon = recent[0] && Date.now() - recent[0].createdAt.getTime() < RESEND_AFTER;
  if (tooSoon || recent.length >= MAX_CODES_PER_HOUR) return sent(res, contact);

  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  await Otp.updateMany({ purpose: PURPOSE, user: user._id, usedAt: null }, { expiresAt: new Date() });
  const otp = await Otp.create({ purpose: PURPOSE, channel: contact.channel, destination: contact.value, user: user._id, codeHash: sha256(code), expiresAt: new Date(Date.now() + CODE_LIFETIME) });
  try {
    if (contact.channel === 'email') {
      if (Email.isConfigured()) await new Email(user, `${req.protocol}://${req.get('host')}/`, { code }).sendDeleteAccountCode();
      else console.log(`[EMAIL NOT SENT: no mail account configured] delete code ${code} for ${contact.value}`);
    } else {
      await sendSms(contact.value, `${code} is your code to delete your Plejar account. It works for 10 minutes. If you didn't ask, ignore this message.`);
    }
  } catch (err) {
    await Otp.deleteOne({ _id: otp._id });
    console.error('[DELETE CODE NOT SENT]', err.message);
  }
  return sent(res, contact, exposeDevCode(contact.channel) ? code : undefined);
});

// POST /api/v1/account-deletion/confirm { identifier, code }
exports.confirm = catchAsync(async (req, res, next) => {
  const contact = readContact(req.body);
  if (contact.error) return fieldErrors(res, { identifier: contact.error });
  const code = String(req.body.code || '').trim();
  if (!/^\d{4}$/.test(code)) return fieldErrors(res, { code: 'Enter the 4-digit code.' });

  const otp = await Otp.findOne({ purpose: PURPOSE, destination: contact.value, usedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 }).select('+codeHash');
  if (!otp) return next(new AppError('This code is wrong or has expired. Ask for a new one.', 400));
  if (otp.attempts >= MAX_TRIES) return next(new AppError('Too many wrong codes. Ask for a new one.', 429));
  if (!sameHash(otp.codeHash, sha256(code))) {
    otp.attempts += 1;
    await otp.save();
    const left = MAX_TRIES - otp.attempts;
    return next(new AppError(left ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.', 400));
  }

  const userId = otp.user;
  const { closed, problem } = await closeAccount(userId, { reason: 'Closed by the traveler on plejar.com' });
  if (!closed) return next(new AppError(problem, 400));
  await logActivity(null, { action: 'user.self_deleted', summary: 'Closed their own account on plejar.com', user: userId });
  res.status(200).json({ status: 'success', message: 'Your Plejar account is deleted.' });
});
