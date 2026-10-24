const Agency = require('../models/agencyModel');
const Package = require('../models/packageModel');
const User = require('../models/userModel');
const AgentLead = require('../models/agentLeadModel');
const Subscriber = require('../models/subscriberModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { sendInvite } = require('../utils/invites');
const { logActivity } = require('../utils/activity');
const { saveAgencyImage, removeAgencyImage } = require('../utils/uploads');
const {
  toList,
  pick,
  PROFILE_FIELDS,
  packageCounts,
  teamView,
  verificationView,
  streamDocument
} = require('./agencyController');

const findAgency = async (id, next, select) => {
  const query = Agency.findById(id);
  if (select) query.select(select);
  const agency = await query;
  if (!agency) {
    next(new AppError('No agency found with that ID.', 404));
    return null;
  }
  return agency;
};

// Dashboard numbers
exports.getStats = catchAsync(async (req, res, next) => {
  const [agencies, activeAgencies, pendingVerification, verifiedAgencies, newLeads, publishedPackages, subscribers, users] =
    await Promise.all([
      Agency.countDocuments(),
      Agency.countDocuments({ status: 'active' }),
      Agency.countDocuments({ 'verification.status': 'pending' }),
      Agency.countDocuments({ verified: true }),
      AgentLead.countDocuments({ $or: [{ status: 'new' }, { unreadReply: true }] }),
      Package.countDocuments({ status: 'published' }),
      Subscriber.countDocuments({ status: 'active' }),
      User.countDocuments()
    ]);

  res.status(200).json({
    status: 'success',
    data: {
      stats: { agencies, activeAgencies, pendingVerification, verifiedAgencies, newLeads, publishedPackages, subscribers, users }
    }
  });
});

// List agencies with owner and counts
exports.listAgencies = catchAsync(async (req, res, next) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.verification) filter['verification.status'] = req.query.verification;

  const agencies = await Agency.find(filter).sort({ createdAt: -1 }).lean();
  const ids = agencies.map(a => a._id);

  const [owners, memberCounts, pkgCounts] = await Promise.all([
    User.find({ agency: { $in: ids }, agencyRole: 'owner' }).select('name email accountStatus agency').lean(),
    User.aggregate([{ $match: { agency: { $in: ids } } }, { $group: { _id: '$agency', count: { $sum: 1 } } }]),
    Package.aggregate([
      { $match: { agency: { $in: ids } } },
      { $group: { _id: '$agency', total: { $sum: 1 }, published: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } } } }
    ])
  ]);

  const byId = (rows, key = '_id') => Object.fromEntries(rows.map(r => [String(r[key]), r]));
  const ownerMap = byId(owners, 'agency');
  const memberMap = byId(memberCounts);
  const pkgMap = byId(pkgCounts);

  const rows = agencies.map(a => ({
    id: a._id,
    name: a.name,
    logo: a.logo,
    regions: a.regions,
    phone: a.phone,
    status: a.status,
    verified: a.verified,
    verificationStatus: a.verification ? a.verification.status : 'none',
    verificationSubmittedAt: a.verification ? a.verification.submittedAt : null,
    createdAt: a.createdAt,
    owner: ownerMap[String(a._id)]
      ? {
          id: ownerMap[String(a._id)]._id,
          name: ownerMap[String(a._id)].name,
          email: ownerMap[String(a._id)].email,
          accountStatus: ownerMap[String(a._id)].accountStatus
        }
      : null,
    members: memberMap[String(a._id)] ? memberMap[String(a._id)].count : 0,
    packages: pkgMap[String(a._id)] ? pkgMap[String(a._id)].total : 0,
    publishedPackages: pkgMap[String(a._id)] ? pkgMap[String(a._id)].published : 0
  }));

  res.status(200).json({ status: 'success', results: rows.length, data: { agencies: rows } });
});

// Full agency detail: profile, verification, team and packages
exports.getAgency = catchAsync(async (req, res, next) => {
  const agency = await findAgency(req.params.id, next);
  if (!agency) return;

  const [members, packages, counts] = await Promise.all([
    User.find({ agency: agency._id }).sort({ agencyRole: 1, name: 1 }),
    Package.find({ agency: agency._id }).sort({ updatedAt: -1 }),
    packageCounts(agency._id)
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      agency,
      verification: verificationView(agency),
      members: members.map(teamView),
      packages,
      stats: { packages: counts, teamSize: members.length }
    }
  });
});

// Edit profile and/or suspend or reactivate
exports.updateAgency = catchAsync(async (req, res, next) => {
  const agency = await findAgency(req.params.id, next);
  if (!agency) return;

  Object.assign(agency, pick(req.body, PROFILE_FIELDS));
  if (req.body.regions !== undefined) agency.regions = toList(req.body.regions);

  if (req.file) {
    const oldLogo = agency.logo;
    agency.logo = await saveAgencyImage(req.file, agency._id, { width: 400, height: 400 });
    await removeAgencyImage(oldLogo);
  }

  await agency.save();
  await logActivity(req, { action: 'agency.edited', summary: 'Plezar admin edited the agency profile', agency: agency._id });
  res.status(200).json({ status: 'success', data: { agency } });
});

// Approve or reject verification documents
exports.verifyAgency = catchAsync(async (req, res, next) => {
  const { decision } = req.body;
  const note = String(req.body.note || '').trim().slice(0, 500);
  if (!['approve', 'reject', 'revoke'].includes(decision)) {
    return next(new AppError('Decision must be approve, reject or revoke.', 400));
  }
  if (decision === 'reject' && !note) {
    return next(new AppError('Add a note telling the agency what to fix.', 400));
  }

  const agency = await findAgency(req.params.id, next);
  if (!agency) return;

  if (decision === 'approve') {
    agency.verified = true;
    agency.verification.status = 'approved';
  } else {
    agency.verified = false;
    agency.verification.status = decision === 'reject' ? 'rejected' : 'none';
  }
  agency.verification.note = note;
  agency.verification.reviewedAt = new Date();
  agency.verification.reviewedBy = req.user._id;
  await agency.save();
  const verbs = { approve: 'Verification approved', reject: `Verification changes requested: ${note}`, revoke: 'Verified mark removed' };
  await logActivity(req, { action: `verification.${decision}`, summary: verbs[decision], agency: agency._id });

  res.status(200).json({ status: 'success', data: { agency, verification: verificationView(agency) } });
});

exports.getAgencyDocument = catchAsync(async (req, res, next) => {
  await streamDocument(req.params.id, req.params.docId, res, next);
});

// Hide or unhide a package (hidden packages can't be republished by the agency)
exports.moderatePackage = catchAsync(async (req, res, next) => {
  const pkg = await Package.findOne({ _id: req.params.packageId, agency: req.params.id });
  if (!pkg) return next(new AppError('No package found with that ID for this agency.', 404));

  if (req.body.hidden === true || req.body.hidden === 'true') {
    pkg.hiddenByAdmin = true;
    pkg.status = 'hidden';
  } else if (req.body.hidden === false || req.body.hidden === 'false') {
    pkg.hiddenByAdmin = false;
    if (pkg.status === 'hidden') pkg.status = 'draft';
  }
  await pkg.save();
  await logActivity(req, { action: pkg.hiddenByAdmin ? 'package.hidden' : 'package.allowed', summary: `${pkg.hiddenByAdmin ? 'Hid' : 'Allowed again'} package "${pkg.title}"`, agency: pkg.agency });

  res.status(200).json({ status: 'success', data: { package: pkg } });
});

// Create an agency with an invited owner (optionally from an agent lead)
exports.createAgency = catchAsync(async (req, res, next) => {
  let lead = null;
  if (req.body.leadId) {
    lead = await AgentLead.findById(req.body.leadId);
    if (!lead) return next(new AppError('No agent lead found with that ID.', 404));
  }

  const agencyName = String(req.body.agencyName || (lead && lead.agencyName) || '').trim();
  const contactName = String(req.body.contactName || (lead && lead.contactName) || '').trim();
  const email = String(req.body.email || (lead && lead.email) || '').trim().toLowerCase();
  const phone = String(req.body.phone || (lead && lead.phone) || '').trim();

  if (!agencyName || !contactName || !email) {
    return next(new AppError('Agency name, owner name and owner email are required.', 400));
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return next(new AppError(`An account already exists for ${email}. Use a different email for this agency owner.`, 400));
  }

  const agency = await Agency.create({
    name: agencyName,
    phone,
    email,
    website: String(req.body.website || (lead && lead.website) || '').trim(),
    regions: toList(req.body.regions || (lead && lead.regions) || ''),
    sourceLead: lead ? lead._id : undefined,
    createdBy: req.user._id
  });

  let owner;
  try {
    owner = await User.create({
      name: contactName,
      email,
      phone,
      role: 'agent',
      agency: agency._id,
      agencyRole: 'owner',
      accountStatus: 'invited'
    });
  } catch (err) {
    await Agency.findByIdAndDelete(agency._id);
    throw err;
  }

  if (lead && lead.status === 'new') {
    lead.status = 'contacted';
    await lead.save();
  }

  const { inviteURL, emailSent } = await sendInvite(owner, agency, req);
  await logActivity(req, { action: 'agency.created', summary: `Agency created and owner ${owner.name} invited`, agency: agency._id });

  res.status(201).json({
    status: 'success',
    message: emailSent
      ? `${agency.name} created and an invite was emailed to ${email}.`
      : `${agency.name} created. Email isn't set up, so send the invite link to ${contactName} yourself.`,
    data: { agency, owner: teamView(owner), inviteURL, emailSent }
  });
});

// Send the owner (or any invited member) a fresh invite link
exports.resendInvite = catchAsync(async (req, res, next) => {
  const agency = await findAgency(req.params.id, next);
  if (!agency) return;

  const member = await User.findOne({ _id: req.params.userId, agency: agency._id });
  if (!member) return next(new AppError('No member found with that ID for this agency.', 404));
  if (member.accountStatus !== 'invited') {
    return next(new AppError('This person has already accepted their invite.', 400));
  }

  const { inviteURL, emailSent } = await sendInvite(member, agency, req);
  res.status(200).json({
    status: 'success',
    message: emailSent ? `Invite sent again to ${member.email}.` : 'New invite link created.',
    data: { inviteURL, emailSent }
  });
});
