const AgentLead = require('../models/agentLeadModel');
const Agency = require('../models/agencyModel');
const User = require('../models/userModel');
const VendorCategory = require('../models/vendorCategoryModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { temporaryPassword, credentialsEmail } = require('../utils/credentials');
const { logActivity } = require('../utils/activity');
const { escapeRegex, pageParams, paged, validId } = require('../utils/query');
const { privateDocumentPath, copyPrivateDocument, removePrivateFolder } = require('../utils/uploads');
const { OPEN_STATUSES, folderFor, statusURL, mail } = require('./applicationController');

const ATTENTION = { $or: [{ status: 'new' }, { unreadReply: true }] };

const toList = value => String(value || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);

const findLead = async (id, next, select) => {
  const lead = validId(id) ? await AgentLead.findById(id).select(select || '') : null;
  if (!lead) next(new AppError('No application found with that ID.', 404));
  return lead;
};

const decidedAlready = (lead, next) => {
  if (lead.status === 'approved' || lead.status === 'rejected') {
    next(new AppError(`This application was already ${lead.status}.`, 400));
    return true;
  }
  return false;
};

// Counts for the status chips, plus how many need someone to look at them
exports.summary = catchAsync(async (req, res) => {
  const [byStatus, attention] = await Promise.all([
    AgentLead.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    AgentLead.countDocuments(ATTENTION)
  ]);
  const counts = Object.fromEntries(AgentLead.STATUSES.map(s => [s, 0]));
  byStatus.forEach(row => { counts[row._id] = row.count; });
  counts.all = byStatus.reduce((sum, row) => sum + row.count, 0);
  counts.open = OPEN_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  res.status(200).json({ status: 'success', data: { counts, attention } });
});

exports.listApplications = catchAsync(async (req, res) => {
  const q = req.query;
  const filter = {};
  if (q.status === 'open') filter.status = { $in: OPEN_STATUSES };
  else if (q.status === 'attention') Object.assign(filter, ATTENTION);
  else if (AgentLead.STATUSES.includes(q.status)) filter.status = q.status;

  if (q.search) {
    const rx = { $regex: escapeRegex(String(q.search).trim()), $options: 'i' };
    filter.$and = [{ $or: ['agencyName', 'contactName', 'email', 'phone', 'reference', 'tradeLicenseNumber', 'regions'].map(f => ({ [f]: rx })) }];
  }

  const page = pageParams(q);
  const [rows, total] = await Promise.all([
    AgentLead.find(filter)
      .sort({ unreadReply: -1, createdAt: q.sort === 'oldest' ? 1 : -1 })
      .skip(page.skip)
      .limit(page.limit)
      .select('reference agencyName contactName phone email regions district status unreadReply documents.kind createdAt decidedAt agency')
      .populate('agency', 'name')
      .lean(),
    AgentLead.countDocuments(filter)
  ]);

  const applications = rows.map(r => ({
    ...r,
    documentCount: (r.documents || []).length,
    hasRequiredDocuments: ['trade_license', 'nid'].every(k => (r.documents || []).some(d => d.kind === k)),
    documents: undefined
  }));
  res.status(200).json({ status: 'success', data: { applications, ...paged(total, page) } });
});

exports.getApplication = catchAsync(async (req, res, next) => {
  const lead = await findLead(req.params.id, next);
  if (!lead) return;

  // Opening it counts as reading the applicant's reply
  if (lead.unreadReply) {
    lead.unreadReply = false;
    await lead.save({ validateBeforeSave: false });
  }

  await lead.populate([
    { path: 'categories', select: 'name active' },
    { path: 'decidedBy', select: 'name' },
    { path: 'agency', select: 'name status verified' }
  ]);

  // Things a reviewer should know before deciding
  const licenseRx = lead.tradeLicenseNumber ? { $regex: `^${escapeRegex(lead.tradeLicenseNumber)}$`, $options: 'i' } : null;
  const [account, otherApplications, agencyWithLicense] = await Promise.all([
    User.findOne({ email: lead.email }).setOptions({ includeInactive: true }).select('name role agency accountStatus').lean(),
    AgentLead.find({
      _id: { $ne: lead._id },
      $or: [{ email: lead.email }, { phone: lead.phone }, ...(licenseRx ? [{ tradeLicenseNumber: licenseRx }] : [])]
    }).select('reference agencyName status createdAt').sort({ createdAt: -1 }).limit(5).lean(),
    licenseRx ? Agency.findOne({ tradeLicenseNumber: licenseRx }).select('name').lean() : null
  ]);

  const owner = lead.agency
    ? await User.findOne({ agency: lead.agency._id || lead.agency, agencyRole: 'owner' }).select('name email mustChangePassword accountStatus lastLoginAt').lean()
    : null;

  res.status(200).json({
    status: 'success',
    data: {
      application: lead,
      owner,
      checks: { account, otherApplications, agencyWithLicense },
      statusURL: lead.reference ? statusURL(req, lead) : ''
    }
  });
});

// Move an application along by hand, or keep notes on it
exports.updateApplication = catchAsync(async (req, res, next) => {
  const lead = await findLead(req.params.id, next);
  if (!lead) return;

  if (req.body.internalNote !== undefined) lead.internalNote = String(req.body.internalNote).slice(0, 2000);
  if (req.body.status !== undefined) {
    if (!['new', 'reviewing', 'archived'].includes(req.body.status)) {
      return next(new AppError('Use approve, reject or request information for other changes.', 400));
    }
    if (lead.status === 'approved') return next(new AppError('An approved application can no longer be changed.', 400));
    lead.status = req.body.status;
  }
  await lead.save();
  res.status(200).json({ status: 'success', data: { application: lead } });
});

// Ask the applicant for something more; they answer on their status page
exports.requestInfo = catchAsync(async (req, res, next) => {
  const lead = await findLead(req.params.id, next);
  if (!lead || decidedAlready(lead, next)) return;
  const note = String(req.body.message || '').trim();
  if (!note) return next(new AppError('Write what you need from the applicant.', 400));
  if (note.length > 2000) return next(new AppError('Keep the message under 2000 characters.', 400));

  lead.messages.push({ from: 'admin', text: note, by: req.user._id, byName: req.user.name });
  lead.status = 'needs_info';
  lead.unreadReply = false;
  await lead.save();

  const emailSent = await mail(lead, statusURL(req, lead), m => { m.data.note = note; return m.sendApplicationInfoRequested(); });
  res.status(200).json({
    status: 'success',
    message: emailSent ? `Request sent to ${lead.email}.` : 'Request saved. Email isn\'t set up, so let the applicant know another way.',
    data: { application: lead, emailSent }
  });
});

exports.reject = catchAsync(async (req, res, next) => {
  const lead = await findLead(req.params.id, next);
  if (!lead || decidedAlready(lead, next)) return;
  const reason = String(req.body.reason || '').trim();
  if (!reason) return next(new AppError('Give a reason. The applicant will see it.', 400));

  lead.status = 'rejected';
  lead.rejectedReason = reason.slice(0, 1000);
  lead.unreadReply = false;
  lead.decidedBy = req.user._id;
  lead.decidedAt = new Date();
  await lead.save();

  const emailSent = await mail(lead, '', m => { m.data.note = lead.rejectedReason; return m.sendApplicationRejected(); });
  res.status(200).json({
    status: 'success',
    message: emailSent ? `Application rejected and ${lead.email} was told why.` : 'Application rejected. Email isn\'t set up, so let the applicant know another way.',
    data: { application: lead, emailSent }
  });
});

// Sign-in details for the admin to email to the vendor (the password is never stored in readable form)
const credentialsFor = (req, owner, agency, password) => {
  const loginURL = `${req.protocol}://${req.get('host')}/agent`;
  return {
    name: owner.name,
    email: owner.email,
    password,
    loginURL,
    emailDraft: credentialsEmail({ name: owner.name, agencyName: agency.name, email: owner.email, password, loginURL })
  };
};

// Accept the agency: create it, carry the documents over, and invite the applicant as its owner
exports.approve = catchAsync(async (req, res, next) => {
  const lead = await findLead(req.params.id, next, '+documents.file');
  if (!lead || decidedAlready(lead, next)) return;

  if (await User.exists({ email: lead.email })) {
    return next(new AppError(`An account already exists for ${lead.email}. Ask the applicant for another email, or invite the agency by hand from All vendors.`, 400));
  }

  const verify = req.body.verify !== false && req.body.verify !== 'false';
  const wantedCategories = req.body.categories !== undefined ? [].concat(req.body.categories) : lead.categories.map(String);
  const categories = (await VendorCategory.find({ _id: { $in: wantedCategories.filter(validId) } }).select('_id')).map(c => c._id);

  const agency = new Agency({
    name: lead.agencyName,
    description: lead.about,
    phone: lead.phone,
    email: lead.email,
    website: lead.website,
    regions: toList(lead.regions),
    tradeLicenseNumber: lead.tradeLicenseNumber,
    categories,
    sourceLead: lead._id,
    createdBy: req.user._id
  });

  // The trade license and NID become the agency's verification documents
  let copied = [];
  try {
    const identity = lead.documents.filter(d => d.kind === 'trade_license' || d.kind === 'nid');
    copied = (await Promise.all(identity.map(async doc => {
      const file = await copyPrivateDocument(doc.file, agency._id);
      return file && { kind: doc.kind, file, originalName: doc.originalName, mimeType: doc.mimeType, uploadedAt: doc.uploadedAt };
    }))).filter(Boolean);
    const reviewed = verify && copied.length > 0;
    let verificationStatus = 'none';
    if (copied.length) verificationStatus = verify ? 'approved' : 'pending';
    agency.verification = {
      status: verificationStatus,
      documents: copied,
      submittedAt: copied.length ? lead.createdAt : undefined,
      reviewedAt: reviewed ? new Date() : undefined,
      reviewedBy: reviewed ? req.user._id : undefined
    };
    agency.verified = reviewed;
    await agency.save();
  } catch (err) {
    await removePrivateFolder(agency._id);
    throw err;
  }

  // The owner's account is ready to use straight away, with a temporary password the admin sends by email
  const password = temporaryPassword();
  let owner;
  try {
    owner = await User.create({
      name: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      role: 'agent',
      agency: agency._id,
      agencyRole: 'owner',
      password,
      confirmPassword: password,
      mustChangePassword: true
    });
  } catch (err) {
    await Agency.findByIdAndDelete(agency._id);
    await removePrivateFolder(agency._id);
    throw err;
  }

  lead.status = 'approved';
  lead.agency = agency._id;
  lead.unreadReply = false;
  lead.decidedBy = req.user._id;
  lead.decidedAt = new Date();
  await lead.save();

  await logActivity(req, {
    action: 'agency.created',
    summary: `Membership application${lead.reference ? ` ${lead.reference}` : ''} approved${agency.verified ? ' and verified' : ''}; vendor account created for ${owner.name}`,
    agency: agency._id
  });

  res.status(201).json({
    status: 'success',
    message: `${agency.name} is now a member. Email the sign-in details below to ${owner.name}; this is the only time the password is shown.`,
    data: {
      application: lead,
      agency: { _id: agency._id, name: agency.name, verified: agency.verified },
      credentials: credentialsFor(req, owner, agency, password)
    }
  });
});

// Lost the sign-in details before sending them? Issue a new temporary password,
// but only while the owner hasn't chosen their own yet.
exports.resetCredentials = catchAsync(async (req, res, next) => {
  const lead = await findLead(req.params.id, next);
  if (!lead) return;
  if (lead.status !== 'approved' || !lead.agency) return next(new AppError('Only accepted applications have a vendor account.', 400));

  const [agency, owner] = await Promise.all([
    Agency.findById(lead.agency).select('name'),
    User.findOne({ agency: lead.agency, agencyRole: 'owner' })
  ]);
  if (!agency || !owner) return next(new AppError('The vendor account for this application no longer exists.', 404));
  // Owners accepted before temporary passwords existed may still be waiting on an invite link
  const notSignedIn = owner.mustChangePassword || owner.accountStatus === 'invited';
  if (!notSignedIn) {
    return next(new AppError(`${owner.name} has already signed in and chosen a password. If they forgot it, they can use "Forgot your password?" on the sign-in page.`, 400));
  }

  const password = temporaryPassword();
  owner.password = password;
  owner.confirmPassword = password;
  owner.mustChangePassword = true;
  owner.accountStatus = 'active';
  owner.inviteToken = undefined;
  owner.inviteExpires = undefined;
  owner.$locals.temporaryPassword = true;
  await owner.save();
  await logActivity(req, { action: 'agency.credentials_reset', summary: `New temporary password issued for ${owner.name}`, agency: agency._id });

  res.status(200).json({
    status: 'success',
    message: 'New temporary password created. The old one no longer works.',
    data: { credentials: credentialsFor(req, owner, agency, password) }
  });
});

exports.deleteApplication = catchAsync(async (req, res, next) => {
  const lead = await findLead(req.params.id, next);
  if (!lead) return;
  await removePrivateFolder(folderFor(lead));
  await lead.deleteOne();
  res.status(204).json({ status: 'success', data: null });
});

exports.getDocument = catchAsync(async (req, res, next) => {
  const lead = await findLead(req.params.id, next, '+documents.file');
  if (!lead) return;
  const doc = lead.documents.id(req.params.docId);
  const filePath = doc && privateDocumentPath(doc.file);
  if (!filePath) return next(new AppError('Document not found.', 404));

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
