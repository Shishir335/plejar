const AgentLead = require('../models/agentLeadModel');
const Agency = require('../models/agencyModel');
const Hotel = require('../models/hotelModel');
const User = require('../models/userModel');
const VendorCategory = require('../models/vendorCategoryModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { temporaryPassword, credentialsEmail, vendorCode } = require('../utils/credentials');
const Email = require('../utils/email');
const { logActivity } = require('../utils/activity');
const { escapeRegex, pageParams, paged, validId } = require('../utils/query');
const { hasPrivateDocument, sendPrivateDocument, copyPrivateDocument, removePrivateFolder } = require('../utils/uploads');
const { OPEN_STATUSES, folderFor, statusURL, mail } = require('./applicationController');
const { addRole } = require('../utils/roles');
const membership = require('../utils/vendorMembership');

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
      .select('reference source vendorType hotel.stayType agencyName contactName phone email regions district status unreadReply documents.kind createdAt decidedAt agency')
      .populate('agency', 'name')
      .lean(),
    AgentLead.countDocuments(filter)
  ]);

  const applications = rows.map(r => ({
    ...r,
    documentCount: (r.documents || []).length,
    // Website: trade license and owner's NID. App: business license, insurance and tax ID
    hasRequiredDocuments: (r.source === 'app' ? ['trade_license', 'insurance', 'tax_id'] : ['trade_license', 'nid']).every(k => (r.documents || []).some(d => d.kind === k)),
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
    { path: 'agency', select: 'name status verified kind' },
    { path: 'hotelListing', select: 'name status' },
    { path: 'applicant', select: 'name email phone' }
  ]);

  // Things a reviewer should know before deciding
  const licenseRx = lead.tradeLicenseNumber ? { $regex: `^${escapeRegex(lead.tradeLicenseNumber)}$`, $options: 'i' } : null;
  const [account, otherApplications, agencyWithLicense] = await Promise.all([
    User.findOne({ email: lead.email }).setOptions({ includeInactive: true }).select('name role roles agency accountStatus').lean(),
    AgentLead.find({
      _id: { $ne: lead._id },
      $or: [{ email: lead.email }, { phone: lead.phone }, ...(licenseRx ? [{ tradeLicenseNumber: licenseRx }] : [])]
    }).select('reference agencyName status createdAt').sort({ createdAt: -1 }).limit(5).lean(),
    licenseRx ? Agency.findOne({ tradeLicenseNumber: licenseRx }).select('name').lean() : null
  ]);

  const owner = lead.agency
    ? await User.findOne(membership.ownerOf(lead.agency._id || lead.agency)).select('name email mustChangePassword accountStatus lastLoginAt').lean()
    : null;

  res.status(200).json({
    status: 'success',
    data: {
      application: lead,
      owner,
      checks: { account, otherApplications, agencyWithLicense },
      statusURL: lead.reference ? statusURL(req, lead) : '',
      appOptions: AgentLead.APP_OPTIONS
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
    message: emailSent ? `Request sent to ${lead.email}.` : emailSent === null ? `Request saved. The email to ${lead.email} is still sending.` : 'Request saved. Email isn\'t set up, so let the applicant know another way.',
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
    message: emailSent ? `Application rejected and ${lead.email} was told why.` : emailSent === null ? `Application rejected. The email to ${lead.email} is still sending.` : 'Application rejected. Email isn\'t set up, so let the applicant know another way.',
    data: { application: lead, emailSent }
  });
});

// Sign-in details for the admin to email to the vendor (the password is never stored in readable form)
const credentialsFor = (req, owner, agency, password) => {
  const loginURL = `${req.protocol}://${req.get('host')}/${agency.kind === 'hotel' ? 'hotel' : 'agent'}`;
  const vendorId = vendorCode(agency);
  return {
    name: owner.name,
    email: owner.email,
    password,
    loginURL,
    vendorId,
    temporary: true,
    emailDraft: credentialsEmail({ name: owner.name, agencyName: agency.name, email: owner.email, password, loginURL, vendorId, hotel: agency.kind === 'hotel' })
  };
};

// A hotel's draft listing, from what it told us when applying. Plejar staff add photos and publish it.
const draftHotel = (lead, agency, userId) => {
  const h = lead.hotel || {};
  return new Hotel({
    name: lead.agencyName,
    type: h.stayType || 'hotel',
    description: (lead.about || '').slice(0, 3000),
    address: (lead.officeAddress || '').slice(0, 200),
    phone: lead.phone,
    website: lead.website,
    starRating: h.starRating || null,
    pricePerNight: h.pricePerNight || 0,
    rooms: h.rooms || null,
    checkIn: h.checkIn || '',
    checkOut: h.checkOut || '',
    agency: agency._id,
    sourceLead: lead._id,
    status: 'draft',
    createdBy: userId
  });
};

// Accept the agency or hotel: create it, carry the documents over, and invite the applicant as its owner.
// A hotel also gets a draft listing.
exports.approve = catchAsync(async (req, res, next) => {
  const lead = await findLead(req.params.id, next, '+documents.file');
  if (!lead || decidedAlready(lead, next)) return;

  // One person can be a traveler and a vendor: an account that already uses this email becomes the
  // owner. The admin reviewing and accepting the application is the confirmation.
  const isHotel = lead.vendorType === 'hotel';
  const existing = await User.findOne({ email: lead.email });
  if (existing) {
    // One tour agency and one hotel per account
    const taken = await membership.cannotLink(existing, isHotel ? 'hotel' : 'agency');
    if (taken) {
      return next(new AppError(taken === 'both'
        ? `${lead.email} already has a tour agency and a hotel. Ask the applicant for another email.`
        : `${lead.email} already has a ${isHotel ? 'hotel' : 'tour agency'}. Ask the applicant for another email.`, 400));
    }
    if (existing.deletedAt || existing.status !== 'active') return next(new AppError(`The account for ${lead.email} is suspended or removed. Ask the applicant for another email.`, 400));
  }

  const verify = req.body.verify !== false && req.body.verify !== 'false';
  const wantedCategories = req.body.categories !== undefined ? [].concat(req.body.categories) : lead.categories.map(String);
  const categories = (await VendorCategory.find({ _id: { $in: wantedCategories.filter(validId) } }).select('_id')).map(c => c._id);

  const agency = new Agency({
    kind: isHotel ? 'hotel' : 'agency',
    name: lead.agencyName,
    address: isHotel ? (lead.officeAddress || '').slice(0, 200) : undefined,
    description: lead.about,
    phone: lead.phone,
    email: lead.email,
    website: lead.website,
    regions: isHotel ? [] : toList(lead.regions),
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

  // The owner's account is ready to use straight away, with a temporary password the admin sends by email.
  // An existing account keeps its own password and just gains the vendor role.
  const password = existing ? null : temporaryPassword();
  let owner;
  try {
    if (existing) {
      owner = existing;
      addRole(owner, 'agent');
      await membership.link(owner, agency, 'owner');
      await owner.save({ validateBeforeSave: false });
    } else owner = await User.create({
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

  let hotel = null;
  if (isHotel) {
    try {
      hotel = await draftHotel(lead, agency, req.user._id).save();
    } catch (err) {
      // Put things back as they were, so the application can be approved again
      if (existing) {
        membership.unlink(owner, agency._id);
        await owner.save({ validateBeforeSave: false });
      } else await User.findByIdAndDelete(owner._id);
      await Agency.findByIdAndDelete(agency._id);
      await removePrivateFolder(agency._id);
      throw err;
    }
    lead.hotelListing = hotel._id;
  }

  lead.status = 'approved';
  lead.agency = agency._id;
  lead.unreadReply = false;
  lead.decidedBy = req.user._id;
  lead.decidedAt = new Date();
  await lead.save();

  await logActivity(req, {
    action: 'agency.created',
    summary: `${isHotel ? 'Hotel' : 'Membership'} application${lead.reference ? ` ${lead.reference}` : ''} approved${agency.verified ? ' and verified' : ''}; vendor account created for ${owner.name}${hotel ? ', with a draft hotel listing' : ''}`,
    agency: agency._id
  });

  // Optionally email the sign-in details straight away; the admin sees them either way
  const credentials = existing ? null : credentialsFor(req, owner, agency, password);
  let emailSent = null;
  if (!existing && (req.body.send === true || req.body.send === 'true')) {
    try {
      await new Email(owner, credentials.loginURL, { agencyName: agency.name, vendorCode: credentials.vendorId, email: owner.email, password, temporary: true, kind: 'new', hotel: isHotel }).sendVendorLogin(credentials.emailDraft.subject);
      emailSent = true;
      owner.credentialsSentAt = new Date();
      await owner.save({ validateBeforeSave: false });
    } catch (err) {
      console.warn(`[MAIL WARNING] Sign-in details to ${owner.email} not sent:`, err.message);
      emailSent = false;
    }
  }
  // An existing account keeps its password, so the email only says the vendor panel is open
  if (existing && (req.body.send === true || req.body.send === 'true')) {
    try {
      await new Email(owner, `${req.protocol}://${req.get('host')}/${isHotel ? 'hotel' : 'agent'}`, { agencyName: agency.name, email: owner.email, hotel: isHotel }).sendVendorAccepted();
      emailSent = true;
    } catch (err) {
      console.warn(`[MAIL WARNING] Acceptance email to ${owner.email} not sent:`, err.message);
      emailSent = false;
    }
  }
  let message = `${agency.name} is now a member. Email the sign-in details below to ${owner.name}; this is the only time the password is shown.`;
  if (emailSent === true) message = `${agency.name} is now a member, and the sign-in details were emailed to ${owner.email}.`;
  if (emailSent === false) message = `${agency.name} is now a member, but the email couldn't be sent (email isn't set up on the server). Send the details below to ${owner.name} yourself.`;
  if (existing) {
    const told = { true: ` They were emailed at ${owner.email}.`, false: " The email couldn't be sent, so let them know yourself." }[emailSent] || '';
    message = `${agency.name} is now a member. ${owner.name} already has a Plejar account, so they sign in to the ${isHotel ? 'hotel panel (/hotel)' : 'tour agency panel (/agent)'} with their usual email and password.${told}`;
  }
  if (hotel) message += ' Its hotel listing was saved as a draft: add photos and publish it from Hotels.';

  res.status(201).json({
    status: 'success',
    message,
    data: {
      application: lead,
      agency: { _id: agency._id, name: agency.name, verified: agency.verified, kind: agency.kind },
      hotel: hotel && { _id: hotel._id, name: hotel.name, status: hotel.status },
      emailSent,
      credentials
    }
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
  if (!doc || !hasPrivateDocument(doc.file)) return next(new AppError('Document not found.', 404));

  res.set({
    'Content-Type': doc.mimeType || 'application/octet-stream',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  sendPrivateDocument(doc.file, res, next);
});
