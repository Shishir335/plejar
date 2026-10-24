const mongoose = require('mongoose');
const User = require('../models/userModel');
const Booking = require('../models/bookingModel');
const Review = require('../models/reviewModel');
const Complaint = require('../models/complaintModel');
const LoginEvent = require('../models/loginEventModel');
const ActivityLog = require('../models/activityLogModel');
const WalletTransaction = require('../models/walletTransactionModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { privateDocumentPath, removePrivateDocument } = require('../utils/uploads');

const ALL = { includeInactive: true }; // admin screens also see deleted accounts
const NOT_DELETED = { active: { $ne: false }, deletedAt: null };
const DELETED = { $or: [{ deletedAt: { $ne: null } }, { active: false }] };

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pageParams = (query, defaultLimit = 20) => {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 100);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { page, limit, skip: (page - 1) * limit };
};

const paged = (total, { page, limit }) => ({ total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) });

// Managers only look after traveler accounts; admins and developers look after everyone
const guard = (req, target, { allowSelf = false } = {}) => {
  if (!allowSelf && String(req.user._id) === String(target._id)) {
    return 'You cannot do this to your own account.';
  }
  if (req.user.role === 'manager' && target.role !== 'user') {
    return 'Managers can only manage traveler accounts. Ask an administrator.';
  }
  return null;
};

const effective = (flag, until) => Boolean(flag) && (!until || new Date(until) > new Date());

const userView = u => {
  const r = u.restrictions || {};
  const v = u.verification || {};
  return {
    id: u._id,
    name: u.name,
    email: u.email,
    phone: u.phone || '',
    address: u.address || '',
    photo: u.photo,
    role: u.role,
    agency: u.agency || null,
    agencyRole: u.agencyRole || null,
    authProvider: u.authProvider,
    accountStatus: u.accountStatus,
    status: u.status || 'active',
    statusReason: u.statusReason || '',
    statusUntil: u.statusUntil || null,
    statusChangedAt: u.statusChangedAt || null,
    deleted: Boolean(u.deletedAt) || u.active === false,
    deletedAt: u.deletedAt || null,
    deletedReason: u.deletedReason || '',
    restrictions: {
      booking: effective(r.booking, r.until),
      reviews: effective(r.reviews, r.until),
      messaging: effective(r.messaging, r.until),
      reason: r.reason || '',
      until: r.until || null
    },
    walletBalance: u.walletBalance || 0,
    lastLoginAt: u.lastLoginAt || null,
    loginCount: u.loginCount || 0,
    verification: {
      status: v.status || 'none',
      note: v.note || '',
      submittedAt: v.submittedAt || null,
      reviewedAt: v.reviewedAt || null,
      documents: (v.documents || []).map(d => ({
        id: d._id, kind: d.kind, originalName: d.originalName, mimeType: d.mimeType, uploadedAt: d.uploadedAt
      }))
    },
    // Accounts don't store a creation date, but their ID does
    joinedAt: u._id.getTimestamp()
  };
};

const findUser = async (id, next, select) => {
  if (!mongoose.isValidObjectId(id)) {
    next(new AppError('No user found with that ID.', 404));
    return null;
  }
  const query = User.findById(id).setOptions(ALL);
  if (select) query.select(select);
  const user = await query;
  if (!user) {
    next(new AppError('No user found with that ID.', 404));
    return null;
  }
  return user;
};

// ---------- List, search and summary ----------

exports.summary = catchAsync(async (req, res, next) => {
  const live = { ...NOT_DELETED };
  const [total, suspended, deactivated, deleted, pendingVerification, restricted, openComplaints] = await Promise.all([
    User.countDocuments(live),
    User.countDocuments({ ...live, status: 'suspended' }),
    User.countDocuments({ ...live, status: 'deactivated' }),
    User.countDocuments(DELETED),
    User.countDocuments({ ...live, 'verification.status': 'pending' }),
    User.countDocuments({ ...live, $or: [{ 'restrictions.booking': true }, { 'restrictions.reviews': true }, { 'restrictions.messaging': true }] }),
    Complaint.countDocuments({ status: { $in: ['open', 'in_review'] } })
  ]);

  res.status(200).json({
    status: 'success',
    data: { summary: { total, active: total - suspended - deactivated, suspended, deactivated, deleted, pendingVerification, restricted, openComplaints } }
  });
});

exports.listUsers = catchAsync(async (req, res, next) => {
  const q = req.query;
  const and = [];

  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search).trim()), 'i');
    and.push({ $or: [{ name: rx }, { email: rx }, { phone: rx }] });
  }
  if (q.role) and.push({ role: q.role });

  if (q.status === 'active') and.push({ status: { $nin: ['suspended', 'deactivated'] } });
  else if (['suspended', 'deactivated'].includes(q.status)) and.push({ status: q.status });

  if (q.verification === 'none') and.push({ 'verification.status': { $in: ['none', null] } });
  else if (['pending', 'approved', 'rejected'].includes(q.verification)) and.push({ 'verification.status': q.verification });

  if (q.restricted === 'true') {
    and.push({ $or: [{ 'restrictions.booking': true }, { 'restrictions.reviews': true }, { 'restrictions.messaging': true }] });
  }

  if (q.deleted === 'only') and.push(DELETED);
  else if (q.deleted !== 'include') and.push(NOT_DELETED);

  const filter = and.length ? { $and: and } : {};
  const sorts = {
    newest: { _id: -1 },
    oldest: { _id: 1 },
    name: { name: 1 },
    lastLogin: { lastLoginAt: -1 },
    submitted: { 'verification.submittedAt': 1 }
  };
  const pg = pageParams(q);

  const [users, total] = await Promise.all([
    User.find(filter).setOptions(ALL).sort(sorts[q.sort] || sorts.newest).skip(pg.skip).limit(pg.limit).lean(),
    User.countDocuments(filter)
  ]);

  res.status(200).json({ status: 'success', data: { users: users.map(userView), ...paged(total, pg) } });
});

// ---------- Profile ----------

exports.getUser = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;

  const id = user._id;
  const [bookings, spent, reviews, ratingAvg, complaintsMade, complaintsAgainst, logins] = await Promise.all([
    Booking.countDocuments({ user: id }),
    Booking.aggregate([{ $match: { user: id, paymentStatus: { $in: ['paid', 'partially_refunded'] } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Review.countDocuments({ user: id }),
    Review.aggregate([{ $match: { user: id } }, { $group: { _id: null, avg: { $avg: '$rating' } } }]),
    Complaint.countDocuments({ reporter: id }),
    Complaint.countDocuments({ againstUser: id }),
    LoginEvent.countDocuments({ user: id })
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      user: userView(user),
      counts: {
        bookings,
        spent: spent[0] ? spent[0].total : 0,
        reviews,
        averageRating: ratingAvg[0] ? Math.round(ratingAvg[0].avg * 10) / 10 : null,
        complaintsMade,
        complaintsAgainst,
        logins
      }
    }
  });
});

exports.updateUser = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const blocked = guard(req, user, { allowSelf: true });
  if (blocked) return next(new AppError(blocked, 403));

  const before = { name: user.name, email: user.email, phone: user.phone };
  ['name', 'email', 'phone', 'address'].forEach(f => {
    if (req.body[f] !== undefined) user[f] = req.body[f];
  });
  await user.save({ validateBeforeSave: true });

  const changed = ['name', 'email', 'phone'].filter(f => before[f] !== user[f]);
  if (changed.length) {
    await logActivity(req, { action: 'user.edited', summary: `Profile details changed by admin: ${changed.join(', ')}`, user: user._id });
  }
  res.status(200).json({ status: 'success', data: { user: userView(user) } });
});

// ---------- Account status, restrictions, delete and restore ----------

exports.setStatus = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const blocked = guard(req, user);
  if (blocked) return next(new AppError(blocked, 403));
  if (user.deletedAt || user.active === false) {
    return next(new AppError('This account is deleted. Restore it before changing its status.', 400));
  }

  const { status } = req.body;
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  if (!['active', 'suspended', 'deactivated'].includes(status)) {
    return next(new AppError('Status must be active, suspended or deactivated.', 400));
  }
  if (status !== 'active' && reason.length < 3) {
    return next(new AppError('Add a reason. The user is shown it when they try to sign in.', 400));
  }

  let until;
  if (status === 'suspended' && req.body.until) {
    until = new Date(req.body.until);
    if (Number.isNaN(until.getTime()) || until <= new Date()) {
      return next(new AppError('The end date must be in the future.', 400));
    }
  }

  const previous = user.status || 'active';
  user.status = status;
  user.statusReason = status === 'active' ? '' : reason;
  user.statusUntil = status === 'suspended' ? until : undefined;
  user.statusChangedAt = new Date();
  user.statusChangedBy = req.user._id;
  await user.save({ validateBeforeSave: false });

  const verb = { active: 'Reactivated', suspended: 'Suspended', deactivated: 'Deactivated' }[status];
  await logActivity(req, {
    action: `user.${status === 'active' ? 'reactivated' : status}`,
    summary: `${verb}${status === 'active' ? ` (was ${previous})` : `: ${reason}`}${until ? ` until ${until.toISOString().slice(0, 10)}` : ''}`,
    user: user._id
  });

  res.status(200).json({ status: 'success', data: { user: userView(user) } });
});

exports.setRestrictions = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const blocked = guard(req, user);
  if (blocked) return next(new AppError(blocked, 403));

  const flags = {
    booking: req.body.booking === true || req.body.booking === 'true',
    reviews: req.body.reviews === true || req.body.reviews === 'true',
    messaging: req.body.messaging === true || req.body.messaging === 'true'
  };
  const any = Object.values(flags).some(Boolean);
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  if (any && reason.length < 3) return next(new AppError('Add a reason for the restriction.', 400));

  let until;
  if (any && req.body.until) {
    until = new Date(req.body.until);
    if (Number.isNaN(until.getTime()) || until <= new Date()) {
      return next(new AppError('The end date must be in the future.', 400));
    }
  }

  user.restrictions = { ...flags, reason: any ? reason : '', until: any ? until : undefined, setBy: req.user._id, setAt: new Date() };
  await user.save({ validateBeforeSave: false });

  const on = Object.entries(flags).filter(([, v]) => v).map(([k]) => k);
  await logActivity(req, {
    action: any ? 'user.restricted' : 'user.restrictions_cleared',
    summary: any ? `Restricted from: ${on.join(', ')}. ${reason}${until ? ` Until ${until.toISOString().slice(0, 10)}.` : ''}` : 'All restrictions removed',
    user: user._id
  });

  res.status(200).json({ status: 'success', data: { user: userView(user) } });
});

exports.deleteUser = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const blocked = guard(req, user);
  if (blocked) return next(new AppError(blocked, 403));
  if (user.role === 'agent') {
    return next(new AppError('Agency accounts belong to an agency. Suspend the agency from Vendors instead, or remove the person from the agency team.', 400));
  }
  if (user.deletedAt || user.active === false) return next(new AppError('This account is already deleted.', 400));

  const reason = String(req.body.reason || '').trim().slice(0, 500);
  if (reason.length < 3) return next(new AppError('Add a reason for deleting this account.', 400));

  user.active = false;
  user.deletedAt = new Date();
  user.deletedBy = req.user._id;
  user.deletedReason = reason;
  await user.save({ validateBeforeSave: false });

  await logActivity(req, { action: 'user.deleted', summary: `Account deleted: ${reason}`, user: user._id });
  res.status(200).json({ status: 'success', data: { user: userView(user) } });
});

exports.restoreUser = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const blocked = guard(req, user);
  if (blocked) return next(new AppError(blocked, 403));
  if (!user.deletedAt && user.active !== false) return next(new AppError('This account is not deleted.', 400));

  user.active = true;
  user.deletedAt = undefined;
  user.deletedBy = undefined;
  user.deletedReason = '';
  await user.save({ validateBeforeSave: false });

  await logActivity(req, { action: 'user.restored', summary: 'Account restored', user: user._id });
  res.status(200).json({ status: 'success', data: { user: userView(user) } });
});

// Removes the account for good. Only possible for deleted accounts with no booking or wallet history.
exports.permanentlyDelete = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next, '+verification.documents.file');
  if (!user) return;
  const blocked = guard(req, user);
  if (blocked) return next(new AppError(blocked, 403));
  if (!user.deletedAt && user.active !== false) {
    return next(new AppError('Delete the account first, then you can remove it permanently.', 400));
  }

  const bookings = await Booking.countDocuments({ user: user._id });
  if (bookings > 0) {
    return next(new AppError(`This account has ${bookings} booking${bookings === 1 ? '' : 's'} on record. Keep it deleted so the history stays correct.`, 400));
  }
  if (user.walletBalance) {
    return next(new AppError('This account still has a wallet balance. Settle it first.', 400));
  }

  await Promise.all(user.verification.documents.map(d => removePrivateDocument(d.file)));
  await Promise.all([
    LoginEvent.deleteMany({ user: user._id }),
    ActivityLog.deleteMany({ user: user._id }),
    WalletTransaction.deleteMany({ user: user._id })
  ]);
  await User.deleteOne({ _id: user._id });

  await logActivity(req, { action: 'user.purged', summary: `Permanently removed account ${user.email}` });
  res.status(204).json({ status: 'success', data: null });
});

// ---------- Verification and documents ----------

exports.verifyUser = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const blocked = guard(req, user);
  if (blocked) return next(new AppError(blocked, 403));

  const { decision } = req.body;
  const note = String(req.body.note || '').trim().slice(0, 500);
  if (!['approve', 'reject', 'reset'].includes(decision)) {
    return next(new AppError('Decision must be approve, reject or reset.', 400));
  }
  if (decision === 'reject' && !note) return next(new AppError('Add a note telling the user what to fix.', 400));
  if (decision === 'approve' && !user.verification.documents.length) {
    return next(new AppError('This user has not uploaded any documents.', 400));
  }

  user.verification.status = { approve: 'approved', reject: 'rejected', reset: 'none' }[decision];
  user.verification.note = note;
  user.verification.reviewedAt = new Date();
  user.verification.reviewedBy = req.user._id;
  await user.save({ validateBeforeSave: false });

  const verb = { approve: 'Identity verified', reject: `Verification rejected: ${note}`, reset: 'Verification reset' }[decision];
  await logActivity(req, { action: `verification.${decision}`, summary: verb, user: user._id });

  res.status(200).json({ status: 'success', data: { user: userView(user) } });
});

exports.getDocument = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next, '+verification.documents.file');
  if (!user) return;
  const doc = user.verification.documents.id(req.params.docId);
  const filePath = doc && privateDocumentPath(doc.file);
  if (!filePath) return next(new AppError('Document not found.', 404));

  await logActivity(req, { action: 'document.viewed', summary: `Admin viewed ${doc.kind.replace('_', ' ')} document`, user: user._id });

  res.set({
    'Content-Type': doc.mimeType || 'application/octet-stream',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.sendFile(filePath, err => {
    if (err && !res.headersSent) next(new AppError('Document not found.', 404));
  });
});

// ---------- Per-user history ----------

exports.userBookings = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const pg = pageParams(req.query, 25);
  const [bookings, total] = await Promise.all([
    Booking.find({ user: user._id }).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('agency', 'name').lean(),
    Booking.countDocuments({ user: user._id })
  ]);
  res.status(200).json({ status: 'success', data: { bookings, ...paged(total, pg) } });
});

exports.userReviews = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const reviews = await Review.find({ user: user._id }).sort({ createdAt: -1 }).limit(100).populate('agency', 'name').populate('booking', 'reference packageTitle').lean();
  res.status(200).json({ status: 'success', data: { reviews } });
});

exports.userComplaints = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const complaints = await Complaint.find({ $or: [{ reporter: user._id }, { againstUser: user._id }] })
    .sort({ createdAt: -1 }).limit(100).populate('reporter', 'name email').populate('againstAgency', 'name').lean();
  res.status(200).json({
    status: 'success',
    data: { complaints: complaints.map(c => ({ ...c, relation: String(c.reporter._id) === String(user._id) ? 'filed' : 'against' })) }
  });
});

exports.userLogins = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const pg = pageParams(req.query, 25);
  const [events, total] = await Promise.all([
    LoginEvent.find({ user: user._id }).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
    LoginEvent.countDocuments({ user: user._id })
  ]);
  res.status(200).json({ status: 'success', data: { events, ...paged(total, pg) } });
});

// Activity feed: actions recorded about the user plus their recent successful sign-ins
exports.userActivity = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const [logs, logins] = await Promise.all([
    ActivityLog.find({ user: user._id }).sort({ createdAt: -1 }).limit(60).lean(),
    LoginEvent.find({ user: user._id, success: true }).sort({ createdAt: -1 }).limit(20).lean()
  ]);

  const feed = [
    ...logs.map(l => ({ at: l.createdAt, action: l.action, summary: l.summary, by: l.actorName || '', ip: l.ip })),
    ...logins.map(l => ({ at: l.createdAt, action: 'login', summary: `Signed in${l.method === 'google' ? ' with Google' : ''}`, by: '', ip: l.ip }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 60);

  res.status(200).json({ status: 'success', data: { activity: feed } });
});

// ---------- Wallet ----------

exports.getWallet = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const transactions = await WalletTransaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(50).populate('createdBy', 'name').lean();
  res.status(200).json({ status: 'success', data: { balance: user.walletBalance || 0, transactions } });
});

exports.adjustWallet = catchAsync(async (req, res, next) => {
  const user = await findUser(req.params.id, next);
  if (!user) return;
  const blocked = guard(req, user, { allowSelf: false });
  if (blocked) return next(new AppError(blocked, 403));
  if (user.deletedAt || user.active === false) return next(new AppError('This account is deleted.', 400));

  const type = req.body.type;
  const amount = Math.round(Number(req.body.amount) * 100) / 100;
  const note = String(req.body.note || '').trim().slice(0, 300);
  if (!['credit', 'debit'].includes(type)) return next(new AppError('Choose credit or debit.', 400));
  if (!(amount > 0) || amount > 1000000) return next(new AppError('Enter an amount between ৳0.01 and ৳1,000,000.', 400));
  if (note.length < 3) return next(new AppError('Add a note explaining the change.', 400));

  // Debits only apply when enough balance exists, so the balance never goes below zero
  const updated = await User.findOneAndUpdate(
    type === 'debit' ? { _id: user._id, walletBalance: { $gte: amount } } : { _id: user._id },
    { $inc: { walletBalance: type === 'debit' ? -amount : amount } },
    { new: true }
  ).setOptions(ALL);
  if (!updated) return next(new AppError('The wallet does not have enough balance for that debit.', 400));

  const tx = await WalletTransaction.create({
    user: user._id,
    type,
    amount,
    balanceAfter: updated.walletBalance,
    reason: 'adjustment',
    note,
    createdBy: req.user._id
  });

  await logActivity(req, { action: `wallet.${type}`, summary: `Wallet ${type === 'credit' ? 'credited' : 'debited'} ৳${amount}: ${note}`, user: user._id });
  res.status(201).json({ status: 'success', data: { balance: updated.walletBalance, transaction: tx } });
});

// ---------- Complaints & reports ----------

const complaintFilter = q => {
  const filter = {};
  if (['open', 'in_review', 'resolved', 'dismissed'].includes(q.status)) filter.status = q.status;
  else if (q.status === 'active') filter.status = { $in: ['open', 'in_review'] };
  if (q.category) filter.category = q.category;
  if (q.priority) filter.priority = q.priority;
  if (q.user && mongoose.isValidObjectId(q.user)) filter.$or = [{ reporter: q.user }, { againstUser: q.user }];
  if (q.agency && mongoose.isValidObjectId(q.agency)) filter.againstAgency = q.agency;
  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search).trim()), 'i');
    filter.$and = [{ $or: [{ subject: rx }, { message: rx }] }];
  }
  return filter;
};

exports.listComplaints = catchAsync(async (req, res, next) => {
  const filter = complaintFilter(req.query);
  const pg = pageParams(req.query);
  const [complaints, total] = await Promise.all([
    Complaint.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit)
      .populate('reporter', 'name email').populate('againstUser', 'name email').populate('againstAgency', 'name').populate('booking', 'reference packageTitle').lean(),
    Complaint.countDocuments(filter)
  ]);
  res.status(200).json({ status: 'success', data: { complaints, ...paged(total, pg) } });
});

exports.updateComplaint = catchAsync(async (req, res, next) => {
  const complaint = mongoose.isValidObjectId(req.params.id) ? await Complaint.findById(req.params.id) : null;
  if (!complaint) return next(new AppError('No complaint found with that ID.', 404));

  const { status, priority } = req.body;
  if (status !== undefined && !['open', 'in_review', 'resolved', 'dismissed'].includes(status)) {
    return next(new AppError('Status must be open, in review, resolved or dismissed.', 400));
  }
  if (priority !== undefined && !['low', 'normal', 'high'].includes(priority)) {
    return next(new AppError('Priority must be low, normal or high.', 400));
  }
  if (req.body.resolution !== undefined) complaint.resolution = String(req.body.resolution).trim().slice(0, 1000);
  if (req.body.internalNote !== undefined) complaint.internalNote = String(req.body.internalNote).trim().slice(0, 1000);
  if (priority) complaint.priority = priority;

  if (status) {
    if (['resolved', 'dismissed'].includes(status) && !complaint.resolution) {
      return next(new AppError('Add a short resolution note before closing this complaint.', 400));
    }
    complaint.status = status;
    complaint.handledBy = req.user._id;
    complaint.resolvedAt = ['resolved', 'dismissed'].includes(status) ? new Date() : undefined;
  }
  await complaint.save();

  if (status) {
    await logActivity(req, { action: `complaint.${status}`, summary: `Complaint "${complaint.subject}" marked ${status.replace('_', ' ')}`, user: complaint.againstUser || complaint.reporter, agency: complaint.againstAgency });
  }
  res.status(200).json({ status: 'success', data: { complaint } });
});

// ---------- Reviews ----------

exports.listReviews = catchAsync(async (req, res, next) => {
  const q = req.query;
  const filter = {};
  if (['visible', 'hidden'].includes(q.status)) filter.status = q.status;
  if (q.rating) filter.rating = Number(q.rating);
  if (q.user && mongoose.isValidObjectId(q.user)) filter.user = q.user;
  if (q.agency && mongoose.isValidObjectId(q.agency)) filter.agency = q.agency;
  if (q.search) filter.comment = new RegExp(escapeRegex(String(q.search).trim()), 'i');
  const pg = pageParams(q);

  const [reviews, total] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit)
      .populate('user', 'name email').populate('agency', 'name').populate('booking', 'reference packageTitle').lean(),
    Review.countDocuments(filter)
  ]);
  res.status(200).json({ status: 'success', data: { reviews, ...paged(total, pg) } });
});

exports.moderateReview = catchAsync(async (req, res, next) => {
  const review = mongoose.isValidObjectId(req.params.id) ? await Review.findById(req.params.id) : null;
  if (!review) return next(new AppError('No review found with that ID.', 404));

  const hide = req.body.hidden === true || req.body.hidden === 'true';
  const reason = String(req.body.reason || '').trim().slice(0, 300);
  if (hide && reason.length < 3) return next(new AppError('Add a reason for hiding this review.', 400));

  review.status = hide ? 'hidden' : 'visible';
  review.hiddenReason = hide ? reason : '';
  review.hiddenBy = hide ? req.user._id : undefined;
  review.hiddenAt = hide ? new Date() : undefined;
  await review.save();

  await logActivity(req, { action: hide ? 'review.hidden' : 'review.restored', summary: hide ? `Review hidden: ${reason}` : 'Review made visible again', user: review.user, agency: review.agency });
  res.status(200).json({ status: 'success', data: { review } });
});

// ---------- Login history and activity (all users) ----------

exports.listLogins = catchAsync(async (req, res, next) => {
  const q = req.query;
  const filter = {};
  if (q.success === 'true') filter.success = true;
  if (q.success === 'false') filter.success = false;
  if (q.user && mongoose.isValidObjectId(q.user)) filter.user = q.user;
  if (q.search) filter.email = new RegExp(escapeRegex(String(q.search).trim()), 'i');
  const pg = pageParams(q, 30);

  const [events, total] = await Promise.all([
    LoginEvent.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('user', 'name role').lean(),
    LoginEvent.countDocuments(filter)
  ]);
  res.status(200).json({ status: 'success', data: { events, ...paged(total, pg) } });
});

exports.listActivity = catchAsync(async (req, res, next) => {
  const q = req.query;
  const filter = {};
  if (q.user && mongoose.isValidObjectId(q.user)) filter.user = q.user;
  if (q.agency === 'any') filter.agency = { $ne: null };
  else if (q.agency && mongoose.isValidObjectId(q.agency)) filter.agency = q.agency;
  if (q.search) filter.summary = new RegExp(escapeRegex(String(q.search).trim()), 'i');
  const pg = pageParams(q, 30);

  const [entries, total] = await Promise.all([
    ActivityLog.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('user', 'name').populate('agency', 'name').lean(),
    ActivityLog.countDocuments(filter)
  ]);
  res.status(200).json({ status: 'success', data: { entries, ...paged(total, pg) } });
});
