const Agency = require('../models/agencyModel');
const Package = require('../models/packageModel');
const User = require('../models/userModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { sendInvite } = require('../utils/invites');
const { agencyBlockedReason } = require('../utils/agencyStanding');
const { logActivity } = require('../utils/activity');
const Booking = require('../models/bookingModel');
const Payout = require('../models/payoutModel');
const { moveBooking } = require('../utils/bookings');
const { earningsFor, monthlyEarnings } = require('../utils/earnings');
const { getDefaultRate, isCustom } = require('../utils/commission');
const {
  saveAgencyImage,
  removeAgencyImage,
  savePrivateDocument,
  privateDocumentPath,
  removePrivateDocument
} = require('../utils/uploads');

const PROFILE_FIELDS = ['name', 'description', 'phone', 'email', 'website', 'tradeLicenseNumber'];
const PACKAGE_FIELDS = ['title', 'destination', 'durationDays', 'durationNights', 'priceFrom', 'description'];

// "Sajek, Bandarban" or ["Sajek", "Bandarban"] -> ["Sajek", "Bandarban"]
const toList = (value, max = 20, separator = /[,\n]/) => {
  const items = Array.isArray(value) ? value : String(value || '').split(separator);
  return items.map(s => String(s).trim()).filter(Boolean).slice(0, max);
};

const pick = (body, fields) => {
  const out = {};
  fields.forEach(f => {
    if (body[f] !== undefined) out[f] = body[f];
  });
  return out;
};

exports.toList = toList;
exports.pick = pick;
exports.PROFILE_FIELDS = PROFILE_FIELDS;

// ---------- Access guards ----------

// Only agents of an active agency can use the agent panel API
exports.requireAgent = catchAsync(async (req, res, next) => {
  if (req.user.role !== 'agent' || !req.user.agency) {
    return next(new AppError('This area is for tour agency accounts only.', 403));
  }

  const agency = await Agency.findById(req.user.agency);
  const blocked = await agencyBlockedReason(agency);
  if (blocked) {
    return next(new AppError(blocked, agency ? 403 : 404));
  }

  req.agency = agency;
  next();
});

exports.requireOwner = (req, res, next) => {
  if (req.user.agencyRole !== 'owner') {
    return next(new AppError('Only the agency owner can do this.', 403));
  }
  next();
};

// ---------- Agency profile ----------

const packageCounts = async agencyId => {
  const rows = await Package.aggregate([
    { $match: { agency: agencyId } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  const counts = { draft: 0, published: 0, hidden: 0 };
  rows.forEach(r => { counts[r._id] = r.count; });
  return counts;
};
exports.packageCounts = packageCounts;

exports.getMyAgency = catchAsync(async (req, res, next) => {
  const [packages, teamSize] = await Promise.all([
    packageCounts(req.agency._id),
    User.countDocuments({ agency: req.agency._id })
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      agency: req.agency,
      me: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        agencyRole: req.user.agencyRole
      },
      stats: { packages, teamSize }
    }
  });
});

exports.updateMyAgency = catchAsync(async (req, res, next) => {
  const agency = req.agency;
  Object.assign(agency, pick(req.body, PROFILE_FIELDS));
  if (req.body.regions !== undefined) agency.regions = toList(req.body.regions);

  if (req.file) {
    const oldLogo = agency.logo;
    agency.logo = await saveAgencyImage(req.file, agency._id, { width: 400, height: 400 });
    await removeAgencyImage(oldLogo);
  }

  await agency.save();
  await logActivity(req, { action: 'agency.profile_updated', summary: 'Updated the agency profile', agency: agency._id });

  res.status(200).json({ status: 'success', data: { agency } });
});

// ---------- Tour packages ----------

const findOwnPackage = async (req, next) => {
  const pkg = await Package.findOne({ _id: req.params.id, agency: req.agency._id });
  if (!pkg) {
    next(new AppError('No package found with that ID in your agency.', 404));
    return null;
  }
  return pkg;
};

const applyPackageStatus = (pkg, status, next) => {
  if (status === undefined) return true;
  if (!['draft', 'published', 'hidden'].includes(status)) {
    next(new AppError('Status must be draft, published or hidden.', 400));
    return false;
  }
  if (status === 'published' && pkg.hiddenByAdmin) {
    next(new AppError('Plezar has hidden this package. Contact support before publishing it again.', 403));
    return false;
  }
  pkg.status = status;
  return true;
};

exports.listMyPackages = catchAsync(async (req, res, next) => {
  const packages = await Package.find({ agency: req.agency._id }).sort({ updatedAt: -1 });
  res.status(200).json({ status: 'success', results: packages.length, data: { packages } });
});

exports.createMyPackage = catchAsync(async (req, res, next) => {
  const pkg = new Package({
    ...pick(req.body, PACKAGE_FIELDS),
    included: toList(req.body.included, 30, /\n/),
    agency: req.agency._id,
    createdBy: req.user._id
  });
  if (!applyPackageStatus(pkg, req.body.status, next)) return;

  await pkg.validate();
  const files = (req.files || []).slice(0, 6);
  pkg.photos = await Promise.all(files.map(file => saveAgencyImage(file, req.agency._id)));
  await pkg.save();
  await logActivity(req, { action: 'package.created', summary: `Added tour package "${pkg.title}" (${pkg.status})`, agency: req.agency._id });

  res.status(201).json({ status: 'success', data: { package: pkg } });
});

exports.updateMyPackage = catchAsync(async (req, res, next) => {
  const pkg = await findOwnPackage(req, next);
  if (!pkg) return;

  Object.assign(pkg, pick(req.body, PACKAGE_FIELDS));
  if (req.body.included !== undefined) pkg.included = toList(req.body.included, 30, /\n/);
  if (!applyPackageStatus(pkg, req.body.status, next)) return;

  // Remove photos the agent deleted, then add new uploads (max 6 in total)
  const removePhotos = toList(req.body.removePhotos, 6);
  const removed = pkg.photos.filter(p => removePhotos.includes(p));
  pkg.photos = pkg.photos.filter(p => !removePhotos.includes(p));

  const files = req.files || [];
  if (pkg.photos.length + files.length > 6) {
    return next(new AppError('A package can have at most 6 photos.', 400));
  }

  await pkg.validate();
  const added = await Promise.all(files.map(file => saveAgencyImage(file, req.agency._id)));
  pkg.photos.push(...added);
  await pkg.save();
  await Promise.all(removed.map(removeAgencyImage));
  await logActivity(req, { action: 'package.updated', summary: `Edited tour package "${pkg.title}" (${pkg.status})`, agency: req.agency._id });

  res.status(200).json({ status: 'success', data: { package: pkg } });
});

exports.deleteMyPackage = catchAsync(async (req, res, next) => {
  const pkg = await findOwnPackage(req, next);
  if (!pkg) return;

  await pkg.deleteOne();
  await Promise.all(pkg.photos.map(removeAgencyImage));
  await logActivity(req, { action: 'package.deleted', summary: `Deleted tour package "${pkg.title}"`, agency: req.agency._id });

  res.status(204).json({ status: 'success', data: null });
});

// ---------- Team ----------

const teamView = u => ({
  id: u._id,
  name: u.name,
  email: u.email,
  agencyRole: u.agencyRole,
  accountStatus: u.accountStatus,
  createdAt: u.createdAt
});
exports.teamView = teamView;

exports.listTeam = catchAsync(async (req, res, next) => {
  const members = await User.find({ agency: req.agency._id }).sort({ agencyRole: 1, name: 1 });
  res.status(200).json({ status: 'success', data: { members: members.map(teamView) } });
});

exports.inviteStaff = catchAsync(async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!name || !email) {
    return next(new AppError('Enter the team member\'s name and email.', 400));
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return next(new AppError('Someone already has a Plezar account with this email. Use a different email.', 400));
  }

  const user = await User.create({
    name,
    email,
    role: 'agent',
    agency: req.agency._id,
    agencyRole: 'staff',
    accountStatus: 'invited'
  });

  const { inviteURL, emailSent } = await sendInvite(user, req.agency, req);
  await logActivity(req, { action: 'team.invited', summary: `Invited ${name} to the team`, agency: req.agency._id });

  res.status(201).json({
    status: 'success',
    message: emailSent ? `Invite sent to ${email}.` : `Invite created. Email isn't set up, so share this link with ${name}.`,
    data: { member: teamView(user), inviteURL, emailSent }
  });
});

const findTeamMember = async (req, next) => {
  const member = await User.findOne({ _id: req.params.userId, agency: req.agency._id });
  if (!member) {
    next(new AppError('No team member found with that ID.', 404));
    return null;
  }
  return member;
};

exports.resendStaffInvite = catchAsync(async (req, res, next) => {
  const member = await findTeamMember(req, next);
  if (!member) return;
  if (member.accountStatus !== 'invited') {
    return next(new AppError('This person has already accepted their invite.', 400));
  }

  const { inviteURL, emailSent } = await sendInvite(member, req.agency, req);
  res.status(200).json({
    status: 'success',
    message: emailSent ? `Invite sent again to ${member.email}.` : 'New invite link created.',
    data: { inviteURL, emailSent }
  });
});

exports.removeStaff = catchAsync(async (req, res, next) => {
  const member = await findTeamMember(req, next);
  if (!member) return;
  if (member.agencyRole === 'owner') {
    return next(new AppError('The agency owner cannot be removed.', 400));
  }

  // Invited people never set a password, so drop the account; others keep a plain user account
  if (member.accountStatus === 'invited') {
    await User.findByIdAndDelete(member._id);
  } else {
    member.role = 'user';
    member.agency = null;
    member.agencyRole = null;
    await member.save({ validateBeforeSave: false });
  }
  await logActivity(req, { action: 'team.removed', summary: `Removed ${member.name} from the team`, agency: req.agency._id });

  res.status(204).json({ status: 'success', data: null });
});

// ---------- Verification ----------

const verificationView = agency => ({
  verified: agency.verified,
  status: agency.verification.status,
  note: agency.verification.note,
  submittedAt: agency.verification.submittedAt,
  reviewedAt: agency.verification.reviewedAt,
  tradeLicenseNumber: agency.tradeLicenseNumber,
  documents: agency.verification.documents.map(d => ({
    id: d._id,
    kind: d.kind,
    originalName: d.originalName,
    mimeType: d.mimeType,
    uploadedAt: d.uploadedAt
  }))
});
exports.verificationView = verificationView;

exports.getVerification = catchAsync(async (req, res, next) => {
  res.status(200).json({ status: 'success', data: { verification: verificationView(req.agency) } });
});

exports.submitVerification = catchAsync(async (req, res, next) => {
  const agency = await Agency.findById(req.agency._id).select('+verification.documents.file');
  const files = req.files || {};
  const tradeLicenseNumber = String(req.body.tradeLicenseNumber || agency.tradeLicenseNumber || '').trim();

  if (!tradeLicenseNumber) {
    return next(new AppError('Enter your trade license number.', 400));
  }

  // Replace any earlier document of the same kind
  const uploads = [
    { kind: 'trade_license', file: files.tradeLicense && files.tradeLicense[0] },
    { kind: 'nid', file: files.nid && files.nid[0] }
  ].filter(u => u.file);
  const stored = await Promise.all(uploads.map(u => savePrivateDocument(u.file, agency._id)));

  const toRemove = [];
  uploads.forEach(({ kind, file }, i) => {
    agency.verification.documents
      .filter(d => d.kind === kind)
      .forEach(d => toRemove.push(d.file));
    agency.verification.documents = agency.verification.documents.filter(d => d.kind !== kind);
    agency.verification.documents.push({
      kind,
      file: stored[i],
      originalName: file.originalname.slice(0, 120),
      mimeType: file.mimetype
    });
  });

  const hasBoth = ['trade_license', 'nid'].every(k => agency.verification.documents.some(d => d.kind === k));
  if (!hasBoth) {
    return next(new AppError('Upload both your trade license and the owner\'s national ID.', 400));
  }

  agency.tradeLicenseNumber = tradeLicenseNumber;
  agency.verification.status = 'pending';
  agency.verification.note = '';
  agency.verification.submittedAt = new Date();
  await agency.save();
  await Promise.all(toRemove.map(removePrivateDocument));
  await logActivity(req, { action: 'verification.submitted', summary: 'Submitted trade license and ID for verification', agency: agency._id });

  res.status(200).json({
    status: 'success',
    message: 'Documents submitted. Plezar will review them and update your verification status.',
    data: { verification: verificationView(agency) }
  });
});

// Stream a private document to an authorised viewer
const streamDocument = async (agencyId, docId, res, next) => {
  const agency = await Agency.findById(agencyId).select('+verification.documents.file');
  const doc = agency && agency.verification.documents.id(docId);
  const filePath = doc && privateDocumentPath(doc.file);
  if (!filePath) {
    return next(new AppError('Document not found.', 404));
  }

  res.set({
    'Content-Type': doc.mimeType || 'application/octet-stream',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.sendFile(filePath, err => {
    if (err && !res.headersSent) next(new AppError('Document not found.', 404));
  });
};
exports.streamDocument = streamDocument;

exports.getMyDocument = catchAsync(async (req, res, next) => {
  await streamDocument(req.agency._id, req.params.docId, res, next);
});

// ---------- Bookings, earnings and payouts (the agency's own) ----------

exports.listMyBookings = catchAsync(async (req, res, next) => {
  const filter = { agency: req.agency._id };
  if (['pending', 'confirmed', 'completed', 'cancelled'].includes(req.query.status)) filter.status = req.query.status;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const [bookings, total] = await Promise.all([
    Booking.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('user', 'name phone').lean(),
    Booking.countDocuments(filter)
  ]);
  res.status(200).json({ status: 'success', data: { bookings, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) } });
});

exports.updateMyBooking = catchAsync(async (req, res, next) => {
  const booking = await Booking.findOne({ _id: req.params.id, agency: req.agency._id });
  if (!booking) return next(new AppError('No booking found with that ID in your agency.', 404));

  moveBooking(booking, req.body.status, { reason: req.body.reason });
  await booking.save();
  await logActivity(req, { action: `booking.${booking.status}`, summary: `Booking ${booking.reference} marked ${booking.status}`, user: booking.user, agency: req.agency._id });

  res.status(200).json({ status: 'success', data: { booking } });
});

exports.getMyEarnings = catchAsync(async (req, res, next) => {
  const [earnings, monthly, defaultRate] = await Promise.all([earningsFor(req.agency._id), monthlyEarnings(req.agency._id, 6), getDefaultRate()]);
  res.status(200).json({
    status: 'success',
    data: { earnings, monthly, commission: { rate: isCustom(req.agency) ? req.agency.commissionRate : defaultRate } }
  });
});

exports.listMyPayouts = catchAsync(async (req, res, next) => {
  const payouts = await Payout.find({ agency: req.agency._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.status(200).json({ status: 'success', data: { payouts } });
});

exports.requestPayout = catchAsync(async (req, res, next) => {
  const amount = Math.round(Number(req.body.amount) * 100) / 100;
  if (!(amount >= 1)) return next(new AppError('Enter an amount of at least ৳1.', 400));

  const earnings = await earningsFor(req.agency._id);
  if (amount > earnings.available) {
    return next(new AppError(`You can request up to ৳${earnings.available}. Money becomes available once a paid trip is completed.`, 400));
  }

  const payout = await Payout.create({
    agency: req.agency._id, amount, method: req.body.method, account: req.body.account, note: req.body.note, source: 'vendor', requestedBy: req.user._id
  });
  await logActivity(req, { action: 'payout.requested', summary: `Requested a payout of ৳${amount} via ${payout.method}`, agency: req.agency._id });
  res.status(201).json({ status: 'success', message: 'Payout requested. Plezar will send it and update the status.', data: { payout } });
});
