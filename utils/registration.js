const validator = require('validator');
const AppError = require('./appError');

// Checks for the traveler sign-up form in the app (also used when editing the profile)

const MIN_AGE = 13;
const MAX_AGE = 120;

// Letters in any script (Bangla included), with spaces, dots, apostrophes and hyphens inside
const NAME_RX = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;

const personNameProblem = (value, label) => {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) return `Enter your ${label}.`;
  if (name.length > 30) return `Your ${label} can be up to 30 characters.`;
  if (!NAME_RX.test(name)) return `Your ${label} can only have letters, spaces, dots, apostrophes and hyphens.`;
  return null;
};

const readPersonName = (value, label) => {
  const problem = personNameProblem(value, label);
  if (problem) throw new AppError(problem, 400);
  return String(value).trim().replace(/\s+/g, ' ');
};

// Age on a given day, counting whole years
const ageOn = (dob, today = new Date()) => {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
};

// Dates come as YYYY-MM-DD and are stored as midnight UTC, so they never shift a day with time zones
const dateOfBirthProblem = value => {
  const text = String(value || '').trim();
  if (!text) return 'Enter your date of birth.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !validator.isDate(text, { format: 'YYYY-MM-DD', strictMode: true })) return 'Enter your date of birth as YYYY-MM-DD, for example 1998-04-21.';
  const dob = new Date(`${text}T00:00:00.000Z`);
  if (dob > new Date()) return "Your date of birth can't be in the future.";
  const age = ageOn(dob);
  if (age < MIN_AGE) return `You need to be at least ${MIN_AGE} to use Plezar.`;
  if (age > MAX_AGE) return 'Check your date of birth.';
  return null;
};

const readDateOfBirth = value => {
  const problem = dateOfBirthProblem(value);
  if (problem) throw new AppError(problem, 400);
  return new Date(`${String(value).trim()}T00:00:00.000Z`);
};

const PHONE_RX = /^(?:\+?880|0)1[3-9]\d{8}$/;

// 01712345678, +8801712345678 and 8801712345678 are all stored as 01712345678
const normalizePhone = value => {
  const phone = String(value || '').replace(/[\s()-]/g, '');
  if (!PHONE_RX.test(phone)) return null;
  return `0${phone.slice(-10)}`;
};

const passwordProblems = (b, errors) => {
  const password = String(b.password || '');
  if (password.length < 8) errors.password = 'Use at least 8 characters for your password.';
  else if (password.length > 100) errors.password = 'Your password can be up to 100 characters.';
  if (!errors.password && password !== String(b.confirmPassword || '')) errors.confirmPassword = "The passwords don't match.";
};

// Name and birth date, checked when sent, or always when required
const profileProblems = (b, { required = false, requireDateOfBirth = required } = {}) => {
  const errors = {};
  const filled = v => String(v || '').trim() !== '';
  if (required || filled(b.firstName)) {
    const first = personNameProblem(b.firstName, 'first name');
    if (first) errors.firstName = first;
  }
  if (required || filled(b.lastName)) {
    const last = personNameProblem(b.lastName, 'last name');
    if (last) errors.lastName = last;
  }
  if (requireDateOfBirth || filled(b.dateOfBirth)) {
    const dob = dateOfBirthProblem(b.dateOfBirth);
    if (dob) errors.dateOfBirth = dob;
  }
  return errors;
};

/**
 * Every problem with a sign-up at once, keyed by field, so the app can show each one
 * under its own input. Returns {} when the form is fine.
 * An email or a mobile number (or both) and a password are required; the name and birth
 * date are asked for in the profile step right after (they are checked here too when sent).
 */
const signupProblems = b => {
  const errors = profileProblems(b);
  const email = String(b.email || '').trim();
  const phone = String(b.phone || '').trim();
  if (!email && !phone) errors.email = 'Enter your email address or mobile number.';
  if (email && !validator.isEmail(email)) errors.email = 'Enter a valid email address, for example rahim@gmail.com.';
  if (phone && !normalizePhone(phone)) errors.phone = 'Enter a Bangladeshi mobile number, for example 01712345678.';
  passwordProblems(b, errors);
  return errors;
};

module.exports = { MIN_AGE, readPersonName, readDateOfBirth, profileProblems, signupProblems, passwordProblems, normalizePhone, PHONE_RX };
