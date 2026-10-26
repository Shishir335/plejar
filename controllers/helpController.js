const mongoose = require('mongoose');
const validator = require('validator');
const HelpArticle = require('../models/helpArticleModel');
const Complaint = require('../models/complaintModel');
const Booking = require('../models/bookingModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { getSetting, setSetting } = require('../utils/settings');

// Help Center in the app (/api/v1/help) and its questions and contact details in the admin panel

const validId = id => mongoose.isValidObjectId(id);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Shown under "Contact Information" until the admin changes them
const DEFAULT_CONTACT = {
  email: 'support@plezar.com',
  emailHours: 'We reply within 24 hours',
  emergencyPhone: '+880 1700-000000',
  emergencyHours: 'Available 24/7 for travelers on a trip',
  headquarters: 'Dhaka, Bangladesh',
  whatsapp: '',
  // "Need Assistance?" on the Travel Agency Application
  partnerEmail: 'partners@plezar.com',
  partnerPhone: '+880 1700-000000'
};
const contactInfo = async () => ({ ...DEFAULT_CONTACT, ...((await getSetting('supportContact', {})) || {}) });
exports.contactInfo = contactInfo;

const articleView = (a, { full = false } = {}) => ({
  _id: a._id,
  category: a.category,
  question: a.question,
  ...(full ? { answer: a.answer, helpful: { yes: a.helpfulYes, no: a.helpfulNo }, updatedAt: a.updatedAt } : { preview: a.answer.slice(0, 140) })
});

/** GET /help — the Help Center screen: categories (with how many answers each has) and contact details */
exports.home = catchAsync(async (req, res) => {
  const counts = await HelpArticle.aggregate([{ $match: { published: true } }, { $group: { _id: '$category', n: { $sum: 1 } } }]);
  const byKey = new Map(counts.map(c => [c._id, c.n]));
  const popular = await HelpArticle.find({ published: true }).sort({ helpfulYes: -1, order: 1 }).limit(5).lean();
  res.status(200).json({
    status: 'success',
    data: {
      categories: HelpArticle.CATEGORIES.map(c => ({ ...c, articles: byKey.get(c.key) || 0 })),
      popular: popular.map(a => articleView(a)),
      contact: await contactInfo()
    }
  });
});

/** GET /help/articles?category=&q= — questions in a category, or a search across all of them */
exports.articles = catchAsync(async (req, res) => {
  const filter = { published: true };
  if (HelpArticle.CATEGORIES.some(c => c.key === req.query.category)) filter.category = req.query.category;
  const q = text(req.query.q, 80);
  if (q) filter.$or = [{ question: new RegExp(escapeRx(q), 'i') }, { answer: new RegExp(escapeRx(q), 'i') }];
  const rows = await HelpArticle.find(filter).sort({ category: 1, order: 1, createdAt: 1 }).limit(100).lean();
  const category = HelpArticle.CATEGORIES.find(c => c.key === filter.category) || null;
  res.status(200).json({ status: 'success', results: rows.length, data: { category, query: q, articles: rows.map(a => articleView(a)) } });
});

// GET /help/articles/:id
exports.article = catchAsync(async (req, res, next) => {
  const a = validId(req.params.id) ? await HelpArticle.findOne({ _id: req.params.id, published: true }).lean() : null;
  if (!a) return next(new AppError('No help article found with that ID.', 404));
  const related = await HelpArticle.find({ published: true, category: a.category, _id: { $ne: a._id } }).sort({ order: 1 }).limit(5).lean();
  res.status(200).json({
    status: 'success',
    data: { article: articleView(a, { full: true }), category: HelpArticle.CATEGORIES.find(c => c.key === a.category), related: related.map(r => articleView(r)) }
  });
});

// POST /help/articles/:id/feedback { helpful: true|false } — "Was this helpful?"
exports.feedback = catchAsync(async (req, res, next) => {
  if (typeof req.body.helpful !== 'boolean') return next(new AppError('Send helpful: true or false.', 400));
  const a = validId(req.params.id) ? await HelpArticle.findOneAndUpdate({ _id: req.params.id, published: true }, { $inc: { [req.body.helpful ? 'helpfulYes' : 'helpfulNo']: 1 } }) : null;
  if (!a) return next(new AppError('No help article found with that ID.', 404));
  res.status(200).json({ status: 'success', message: 'Thanks for the feedback.' });
});

/**
 * POST /help/contact — "Contact Us" / "Contact Support":
 * { name, email, subject, category (a Help Center topic key, or any text), message, bookingId? }.
 * Name and email default to the account's. Lands in the admin's Complaints list as a help request.
 */
exports.contact = catchAsync(async (req, res) => {
  const b = req.body;
  const errors = {};
  const raw = text(b.category || b.topic, 80);
  const topic = HelpArticle.CATEGORIES.find(c => c.key === raw);
  const topicText = topic ? topic.label : raw;
  const subject = text(b.subject, 150) || topicText;
  const message = text(b.message, 3000);
  const name = text(b.name, 80) || req.user.name || '';
  const email = (text(b.email, 200) || req.user.email || '').toLowerCase();
  if (name.length < 2) errors.name = 'Enter your name.';
  if (!email) errors.email = 'Enter your email so we can reply.';
  else if (!validator.isEmail(email)) errors.email = 'Enter a valid email address.';
  if (!subject) errors.subject = 'Enter a subject.';
  if (b.category !== undefined && !raw) errors.category = 'Enter a category.';
  if (message.length < 10) errors.message = 'Describe the problem in a few words (at least 10 characters).';
  let booking;
  if (b.bookingId) {
    booking = validId(b.bookingId) ? await Booking.findOne({ _id: b.bookingId, user: req.user._id }).select('_id agency reference') : null;
    if (!booking) errors.bookingId = 'Choose one of your bookings.';
  }
  if (Object.keys(errors).length) return res.status(400).json({ status: 'fail', message: Object.values(errors)[0], errors });
  const complaint = await Complaint.create({
    reporter: req.user._id,
    category: 'help_request',
    subject: topicText && b.subject ? `${topicText}: ${subject}`.slice(0, 150) : subject,
    message,
    contactName: name,
    contactEmail: email,
    topic: topicText,
    booking: booking ? booking._id : undefined,
    againstAgency: booking ? booking.agency : undefined
  });
  await logActivity(req, { action: 'help.contacted', summary: `Asked Plezar support: ${complaint.subject}`, user: req.user._id });
  const contact = await contactInfo();
  res.status(201).json({
    status: 'success',
    message: `Thanks, we got your message and will reply to ${email}. ${contact.emailHours || ''}`.trim(),
    data: { request: { _id: complaint._id, status: complaint.status, subject: complaint.subject, createdAt: complaint.createdAt } }
  });
});

// ---------- Admin ----------

const applyForm = (a, b) => {
  if (b.category !== undefined) {
    if (!HelpArticle.CATEGORIES.some(c => c.key === b.category)) throw new AppError('Choose a category.', 400);
    a.category = b.category;
  }
  if (b.question !== undefined) a.question = text(b.question, 200);
  if (b.answer !== undefined) a.answer = text(b.answer, 5000);
  if (b.order !== undefined) a.order = Number(b.order) || 0;
  if (b.published !== undefined) a.published = b.published === true || b.published === 'true';
};

const adminArticle = a => ({ ...articleView(a, { full: true }), order: a.order, published: a.published });

exports.adminList = catchAsync(async (req, res) => {
  const rows = await HelpArticle.find().sort({ category: 1, order: 1, createdAt: 1 }).lean();
  res.status(200).json({ status: 'success', data: { articles: rows.map(adminArticle), categories: HelpArticle.CATEGORIES, contact: await contactInfo() } });
});

exports.adminCreate = catchAsync(async (req, res) => {
  const a = new HelpArticle({ updatedBy: req.user._id });
  applyForm(a, req.body);
  await a.save();
  await logActivity(req, { action: 'help.article_created', summary: `Help article added: ${a.question}` });
  res.status(201).json({ status: 'success', data: { article: adminArticle(a.toObject()) } });
});

exports.adminUpdate = catchAsync(async (req, res, next) => {
  const a = validId(req.params.id) ? await HelpArticle.findById(req.params.id) : null;
  if (!a) return next(new AppError('No help article found with that ID.', 404));
  applyForm(a, req.body);
  a.updatedBy = req.user._id;
  await a.save();
  await logActivity(req, { action: 'help.article_updated', summary: `Help article updated: ${a.question}` });
  res.status(200).json({ status: 'success', data: { article: adminArticle(a.toObject()) } });
});

exports.adminDelete = catchAsync(async (req, res, next) => {
  const a = validId(req.params.id) ? await HelpArticle.findByIdAndDelete(req.params.id) : null;
  if (!a) return next(new AppError('No help article found with that ID.', 404));
  await logActivity(req, { action: 'help.article_deleted', summary: `Help article deleted: ${a.question}` });
  res.status(204).json({ status: 'success', data: null });
});

// PATCH /admin/help/contact { email, emailHours, emergencyPhone, emergencyHours, headquarters, whatsapp, partnerEmail, partnerPhone }
exports.adminUpdateContact = catchAsync(async (req, res) => {
  const current = await contactInfo();
  const next = { ...current };
  Object.keys(DEFAULT_CONTACT).forEach(k => {
    if (req.body[k] !== undefined) next[k] = text(req.body[k], 200);
  });
  await setSetting('supportContact', next, req.user._id);
  await logActivity(req, { action: 'help.contact_updated', summary: 'Updated the Help Center contact details' });
  res.status(200).json({ status: 'success', message: 'Contact details saved.', data: { contact: next } });
});

// GET/PATCH /admin/rewards-settings — points per taka and the referral rewards
const REWARD_SETTINGS = { pointsPerTaka: 1, referralReward: 1000, referralWelcomeBonus: 500 };
exports.adminRewardSettings = catchAsync(async (req, res, next) => {
  if (req.method === 'PATCH') {
    const entries = Object.keys(REWARD_SETTINGS).filter(k => req.body[k] !== undefined && req.body[k] !== '');
    const bad = entries.find(k => !Number.isFinite(Number(req.body[k])) || Number(req.body[k]) < 0 || Number(req.body[k]) > 100000);
    if (bad) return next(new AppError(`${bad} should be a number from 0 to 100000.`, 400));
    await Promise.all(entries.map(k => setSetting(k, Number(req.body[k]), req.user._id)));
    if (entries.length) await logActivity(req, { action: 'rewards.settings_updated', summary: `Updated reward settings: ${entries.map(k => `${k} ${req.body[k]}`).join(', ')}` });
  }
  const values = await Promise.all(Object.entries(REWARD_SETTINGS).map(async ([k, d]) => [k, Number(await getSetting(k, d))]));
  res.status(200).json({ status: 'success', data: { settings: Object.fromEntries(values) } });
});
