const Agency = require('../models/agencyModel');
const Package = require('../models/packageModel');
const User = require('../models/userModel');
const Booking = require('../models/bookingModel');
const Review = require('../models/reviewModel');
const Complaint = require('../models/complaintModel');
const Payout = require('../models/payoutModel');
const AgentLead = require('../models/agentLeadModel');
const VendorCategory = require('../models/vendorCategoryModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { earningsFor, monthlyEarnings, round, PAID } = require('../utils/earnings');
const { getDefaultRate, isCustom } = require('../utils/commission');
const { escapeRegex, pageParams, paged, validId, toId } = require('../utils/query');
const { savePrivateDocument, removePrivateDocument, privateDocumentPath } = require('../utils/uploads');
const { teamView, verificationView, packageCounts } = require('./agencyController');
const { temporaryPassword, credentialsEmail, vendorCode } = require('../utils/credentials');
const Email = require('../utils/email');
const { reportPeriod, buildReport, reportText } = require('../utils/vendorReport');
const { sendReport, reportRecipients } = require('../utils/reportMailer');
const { planProblems } = require('../utils/tourPlan');

const findVendor = async (id, next, select) => {
  if (!validId(id)) {
    next(new AppError('No vendor found with that ID.', 404));
    return null;
  }
  const query = Agency.findById(id);
  if (select) query.select(select);
  const agency = await query;
  if (!agency) {
    next(new AppError('No vendor found with that ID.', 404));
    return null;
  }
  return agency;
};

const dhakaDay = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date);
const lastDays = (count = 30) => Array.from({ length: count }, (_, i) => dhakaDay(new Date(Date.now() - (count - 1 - i) * 86400000)));

const contractView = agency => {
  const c = agency.contract || {};
  const doc = c.document || {};
  const expired = c.status === 'signed' && c.endDate && new Date(c.endDate) < new Date();
  return {
    status: expired ? 'expired' : c.status || 'none',
    storedStatus: c.status || 'none',
    version: c.version || '',
    startDate: c.startDate || null,
    endDate: c.endDate || null,
    daysLeft: c.status === 'signed' && c.endDate ? Math.ceil((new Date(c.endDate) - Date.now()) / 86400000) : null,
    agreedCommission: typeof c.agreedCommission === 'number' ? c.agreedCommission : null,
    terms: c.terms || '',
    signedBy: c.signedBy || '',
    signedAt: c.signedAt || null,
    hasDocument: Boolean(doc.originalName),
    documentName: doc.originalName || '',
    documentUploadedAt: doc.uploadedAt || null,
    updatedAt: c.updatedAt || null
  };
};

const ratingSummary = async agencyId => {
  const rows = await Review.aggregate([
    { $match: { agency: toId(agencyId) } },
    { $group: { _id: { status: '$status', rating: '$rating' }, count: { $sum: 1 } } }
  ]);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let hidden = 0;
  rows.forEach(r => {
    if (r._id.status === 'visible') distribution[r._id.rating] += r.count;
    else hidden += r.count;
  });
  const count = Object.values(distribution).reduce((a, b) => a + b, 0);
  const total = Object.entries(distribution).reduce((a, [star, n]) => a + Number(star) * n, 0);
  return { average: count ? Math.round((total / count) * 10) / 10 : null, count, distribution, hidden };
};

// ---------- Summary and list ----------

exports.summary = catchAsync(async (req, res, next) => {
  const [total, active, suspended, deactivated, verified, pendingVerification, invited, newLeads, payoutRows, categories] = await Promise.all([
    Agency.countDocuments(),
    Agency.countDocuments({ status: 'active' }),
    Agency.countDocuments({ status: 'suspended' }),
    Agency.countDocuments({ status: 'deactivated' }),
    Agency.countDocuments({ verified: true }),
    Agency.countDocuments({ 'verification.status': 'pending' }),
    User.countDocuments({ role: 'agent', agencyRole: 'owner', accountStatus: 'invited' }),
    AgentLead.countDocuments({ $or: [{ status: 'new' }, { unreadReply: true }] }),
    Payout.aggregate([{ $match: { status: 'pending' } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    VendorCategory.countDocuments()
  ]);
  const p = payoutRows[0] || { amount: 0, count: 0 };

  res.status(200).json({
    status: 'success',
    data: { summary: { total, active, suspended, deactivated, verified, pendingVerification, invited, newLeads, pendingPayouts: p.count, pendingPayoutAmount: round(p.amount), categories } }
  });
});

exports.listVendors = catchAsync(async (req, res, next) => {
  const q = req.query;
  const and = [];

  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search).trim()), 'i');
    and.push({ $or: [{ name: rx }, { email: rx }, { phone: rx }, { regions: rx }] });
  }
  if (['active', 'suspended', 'deactivated'].includes(q.status)) and.push({ status: q.status });
  if (q.verification === 'verified') and.push({ verified: true });
  else if (['pending', 'rejected'].includes(q.verification)) and.push({ 'verification.status': q.verification });
  else if (q.verification === 'none') and.push({ verified: false, 'verification.status': { $in: ['none', null] } });
  if (q.category && validId(q.category)) and.push({ categories: toId(q.category) });
  if (q.commission === 'custom') and.push({ commissionRate: { $type: 'number' } });

  const filter = and.length ? { $and: and } : {};
  const sorts = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, name: { name: 1 } };
  const pg = pageParams(q);

  const [agencies, total, defaultRate] = await Promise.all([
    Agency.find(filter).sort(sorts[q.sort] || sorts.newest).skip(pg.skip).limit(pg.limit).populate('categories', 'name').lean(),
    Agency.countDocuments(filter),
    getDefaultRate()
  ]);
  const ids = agencies.map(a => a._id);

  const [owners, members, pkgs, bookings, ratings] = await Promise.all([
    User.find({ agency: { $in: ids }, agencyRole: 'owner' }).select('name email accountStatus agency').lean(),
    User.aggregate([{ $match: { agency: { $in: ids } } }, { $group: { _id: '$agency', count: { $sum: 1 } } }]),
    Package.aggregate([{ $match: { agency: { $in: ids } } }, { $group: { _id: '$agency', total: { $sum: 1 }, published: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } } } }]),
    Booking.aggregate([
      { $match: { agency: { $in: ids } } },
      { $group: {
        _id: '$agency',
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        gross: { $sum: { $cond: [{ $in: ['$paymentStatus', PAID] }, '$amount', 0] } }
      } }
    ]),
    Review.aggregate([{ $match: { agency: { $in: ids }, status: 'visible' } }, { $group: { _id: '$agency', avg: { $avg: '$rating' }, count: { $sum: 1 } } }])
  ]);
  const by = (rows, key = '_id') => Object.fromEntries(rows.map(r => [String(r[key]), r]));
  const ownerMap = by(owners, 'agency'); const memberMap = by(members); const pkgMap = by(pkgs); const bookingMap = by(bookings); const ratingMap = by(ratings);

  const rows = agencies.map(a => {
    const k = String(a._id);
    const o = ownerMap[k];
    const b = bookingMap[k] || { total: 0, completed: 0, cancelled: 0, gross: 0 };
    const r = ratingMap[k];
    return {
      id: a._id,
      name: a.name,
      logo: a.logo,
      regions: a.regions,
      phone: a.phone,
      status: a.status,
      verified: a.verified,
      verificationStatus: a.verification ? a.verification.status : 'none',
      categories: (a.categories || []).map(c => ({ id: c._id, name: c.name })),
      commission: { rate: isCustom(a) ? a.commissionRate : defaultRate, custom: isCustom(a) },
      owner: o ? { id: o._id, name: o.name, email: o.email, accountStatus: o.accountStatus } : null,
      members: (memberMap[k] || {}).count || 0,
      packages: { total: (pkgMap[k] || {}).total || 0, published: (pkgMap[k] || {}).published || 0 },
      bookings: { total: b.total, completed: b.completed, cancelled: b.cancelled },
      revenue: round(b.gross),
      rating: r ? { average: Math.round(r.avg * 10) / 10, count: r.count } : { average: null, count: 0 },
      createdAt: a.createdAt
    };
  });

  res.status(200).json({ status: 'success', data: { vendors: rows, ...paged(total, pg) } });
});

// ---------- Profile ----------

exports.getVendor = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next);
  if (!agency) return;
  await agency.populate('categories', 'name');

  const [members, packages, counts, earnings, ratings, defaultRate, bookingCount, complaintCount] = await Promise.all([
    User.find({ agency: agency._id }).sort({ agencyRole: 1, name: 1 }),
    Package.find({ agency: agency._id }).sort({ updatedAt: -1 }).populate('itinerary.stops.destinationRef', 'name slug'),
    packageCounts(agency._id),
    earningsFor(agency._id),
    ratingSummary(agency._id),
    getDefaultRate(),
    Booking.countDocuments({ agency: agency._id }),
    Complaint.countDocuments({ againstAgency: agency._id })
  ]);

  const profile = agency.toObject();
  delete profile.contract; // sent separately, without the private file path
  res.status(200).json({
    status: 'success',
    data: {
      agency: profile,
      categories: (agency.categories || []).map(c => ({ id: c._id, name: c.name })),
      verification: verificationView(agency),
      contract: contractView(agency),
      commission: { rate: isCustom(agency) ? agency.commissionRate : defaultRate, custom: isCustom(agency), defaultRate },
      members: members.map(teamView),
      vendorId: vendorCode(agency),
      packages: packages.map(p => ({ ...p.toObject(), planMissing: planProblems(p) })),
      earnings,
      ratings,
      stats: { packages: counts, teamSize: members.length, bookings: bookingCount, complaints: complaintCount }
    }
  });
});

// ---------- Status: suspend, deactivate, reactivate ----------

exports.setStatus = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next);
  if (!agency) return;

  const { status } = req.body;
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  if (!['active', 'suspended', 'deactivated'].includes(status)) {
    return next(new AppError('Status must be active, suspended or deactivated.', 400));
  }
  if (status !== 'active' && reason.length < 3) {
    return next(new AppError('Add a reason. The agency sees it when they try to sign in.', 400));
  }
  let until;
  if (status === 'suspended' && req.body.until) {
    until = new Date(req.body.until);
    if (Number.isNaN(until.getTime()) || until <= new Date()) {
      return next(new AppError('The end date must be in the future.', 400));
    }
  }

  const previous = agency.status;
  agency.status = status;
  agency.statusReason = status === 'active' ? '' : reason;
  agency.statusUntil = status === 'suspended' ? until : undefined;
  agency.statusChangedAt = new Date();
  agency.statusChangedBy = req.user._id;
  await agency.save();

  const verb = { active: `Reactivated (was ${previous})`, suspended: `Suspended: ${reason}`, deactivated: `Deactivated: ${reason}` }[status];
  await logActivity(req, { action: `agency.${status === 'active' ? 'reactivated' : status}`, summary: `${verb}${until ? ` until ${until.toISOString().slice(0, 10)}` : ''}`, agency: agency._id });

  res.status(200).json({ status: 'success', data: { agency } });
});

// ---------- Categories assigned to a vendor ----------

exports.setCategories = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next);
  if (!agency) return;
  const ids = Array.isArray(req.body.categories) ? req.body.categories.filter(validId) : [];
  const found = await VendorCategory.find({ _id: { $in: ids } }).select('name');
  agency.categories = found.map(c => c._id);
  await agency.save();

  await logActivity(req, { action: 'agency.categories', summary: `Categories set to: ${found.map(c => c.name).join(', ') || 'none'}`, agency: agency._id });
  res.status(200).json({ status: 'success', data: { categories: found.map(c => ({ id: c._id, name: c.name })) } });
});

// ---------- Commission ----------

exports.setCommission = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next);
  if (!agency) return;

  const raw = req.body.rate;
  const reset = raw === null || raw === '' || raw === undefined;
  const rate = reset ? null : Number(raw);
  if (!reset && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
    return next(new AppError('Commission must be between 0% and 100%.', 400));
  }

  const defaultRate = await getDefaultRate();
  const before = isCustom(agency) ? agency.commissionRate : defaultRate;
  agency.commissionRate = rate;
  await agency.save();

  const now = rate === null ? defaultRate : rate;
  await logActivity(req, { action: 'agency.commission', summary: rate === null ? `Commission reset to the platform default (${defaultRate}%), was ${before}%` : `Commission changed from ${before}% to ${rate}%. Applies to new bookings only.`, agency: agency._id });
  res.status(200).json({ status: 'success', data: { commission: { rate: now, custom: rate !== null, defaultRate } } });
});

// ---------- Contract / agreement ----------

exports.updateContract = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next, '+contract.document.file');
  if (!agency) return;
  const b = req.body;
  const c = agency.contract;

  if (b.status !== undefined) {
    if (!['none', 'draft', 'sent', 'signed', 'terminated'].includes(b.status)) {
      return next(new AppError('Contract status must be none, draft, sent, signed or terminated.', 400));
    }
    c.status = b.status;
  }
  const date = (value, label) => {
    if (value === undefined) return undefined;
    if (value === '' || value === null) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new AppError(`${label} is not a valid date.`, 400);
    return d;
  };
  const start = date(b.startDate, 'Start date');
  const end = date(b.endDate, 'End date');
  if (start !== undefined) c.startDate = start || undefined;
  if (end !== undefined) c.endDate = end || undefined;
  if (c.startDate && c.endDate && c.endDate <= c.startDate) {
    return next(new AppError('The end date must be after the start date.', 400));
  }
  if (b.version !== undefined) c.version = String(b.version).trim().slice(0, 20);
  if (b.terms !== undefined) c.terms = String(b.terms).trim().slice(0, 4000);
  if (b.signedBy !== undefined) c.signedBy = String(b.signedBy).trim().slice(0, 100);
  if (b.agreedCommission !== undefined) {
    if (b.agreedCommission === '' || b.agreedCommission === null) c.agreedCommission = undefined;
    else {
      const n = Number(b.agreedCommission);
      if (!Number.isFinite(n) || n < 0 || n > 100) return next(new AppError('Agreed commission must be between 0% and 100%.', 400));
      c.agreedCommission = n;
    }
  }
  if (c.status === 'signed') {
    if (!c.signedBy) return next(new AppError('Add the name of the person who signed for the agency.', 400));
    c.signedAt = date(b.signedAt, 'Signed date') || c.signedAt || new Date();
  }

  const oldFile = c.document && c.document.file;
  if (req.file) {
    const stored = await savePrivateDocument(req.file, `contract-${agency.id}`);
    c.document = { file: stored, originalName: req.file.originalname.slice(0, 120), mimeType: req.file.mimetype, uploadedAt: new Date() };
    if (oldFile) await removePrivateDocument(oldFile);
  } else if (b.removeDocument === 'true' || b.removeDocument === true) {
    c.document = undefined;
    if (oldFile) await removePrivateDocument(oldFile);
  }

  c.updatedAt = new Date();
  c.updatedBy = req.user._id;
  await agency.save();

  await logActivity(req, { action: 'agency.contract', summary: `Contract updated: ${c.status}${c.version ? `, version ${c.version}` : ''}${req.file ? ', document uploaded' : ''}`, agency: agency._id });
  res.status(200).json({ status: 'success', data: { contract: contractView(agency) } });
});

exports.getContractDocument = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next, '+contract.document.file');
  if (!agency) return;
  const doc = agency.contract && agency.contract.document;
  const filePath = doc && doc.file && privateDocumentPath(doc.file);
  if (!filePath) return next(new AppError('No contract document has been uploaded.', 404));

  res.set({ 'Content-Type': doc.mimeType || 'application/octet-stream', 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(filePath, err => {
    if (err && !res.headersSent) next(new AppError('Document not found.', 404));
  });
});

// ---------- Performance, ratings, earnings ----------

exports.getPerformance = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next);
  if (!agency) return;
  const id = agency._id;
  const aid = toId(id);
  const since = new Date(Date.now() - 30 * 86400000);
  const dates = lastDays();

  const [statusRows, last30, userRows, dailyRows, ratings, openComplaints, totalComplaints, pkg] = await Promise.all([
    Booking.aggregate([{ $match: { agency: aid } }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    Booking.aggregate([{ $match: { agency: aid, createdAt: { $gte: since } } }, { $group: { _id: null, bookings: { $sum: 1 }, gross: { $sum: { $cond: [{ $in: ['$paymentStatus', PAID] }, '$amount', 0] } } } }]),
    Booking.aggregate([{ $match: { agency: aid, status: { $ne: 'cancelled' } } }, { $group: { _id: '$user', n: { $sum: 1 } } }]),
    Booking.aggregate([
      { $match: { agency: aid, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Dhaka' } }, bookings: { $sum: 1 }, gross: { $sum: { $cond: [{ $in: ['$paymentStatus', PAID] }, '$amount', 0] } } } }
    ]),
    ratingSummary(id),
    Complaint.countDocuments({ againstAgency: id, status: { $in: ['open', 'in_review'] } }),
    Complaint.countDocuments({ againstAgency: id }),
    packageCounts(id)
  ]);

  const st = Object.fromEntries(statusRows.map(r => [r._id, r]));
  const n = key => (st[key] ? st[key].count : 0);
  const total = statusRows.reduce((a, r) => a + r.count, 0);
  const live = total - n('cancelled');
  const liveAmount = statusRows.filter(r => r._id !== 'cancelled').reduce((a, r) => a + r.amount, 0);
  const customers = userRows.length;
  const repeat = userRows.filter(r => r.n > 1).length;
  const dayMap = new Map(dailyRows.map(r => [r._id, r]));
  const l30 = last30[0] || { bookings: 0, gross: 0 };

  res.status(200).json({
    status: 'success',
    data: {
      metrics: {
        bookings: total,
        confirmed: n('confirmed'),
        completed: n('completed'),
        cancelled: n('cancelled'),
        pending: n('pending'),
        cancellationRate: total ? round((n('cancelled') / total) * 100) : null,
        completionRate: n('completed') + n('cancelled') ? round((n('completed') / (n('completed') + n('cancelled'))) * 100) : null,
        averageBookingValue: live ? round(liveAmount / live) : null,
        customers,
        repeatCustomers: repeat,
        repeatRate: customers ? round((repeat / customers) * 100) : null,
        rating: ratings,
        openComplaints,
        totalComplaints,
        publishedPackages: pkg.published,
        totalPackages: pkg.draft + pkg.published + pkg.hidden,
        last30Bookings: l30.bookings,
        last30Revenue: round(l30.gross)
      },
      series: {
        dates,
        bookings: dates.map(d => (dayMap.get(d) || {}).bookings || 0),
        revenue: dates.map(d => round((dayMap.get(d) || {}).gross || 0))
      }
    }
  });
});

exports.getRatings = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next);
  if (!agency) return;
  res.status(200).json({ status: 'success', data: { ratings: await ratingSummary(agency._id) } });
});

exports.getEarnings = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next);
  if (!agency) return;
  const [earnings, monthly, defaultRate] = await Promise.all([earningsFor(agency._id), monthlyEarnings(agency._id, 6), getDefaultRate()]);
  res.status(200).json({
    status: 'success',
    data: { earnings, monthly, commission: { rate: isCustom(agency) ? agency.commissionRate : defaultRate, custom: isCustom(agency) } }
  });
});

// Set or change the password of a vendor's owner or team member.
// Either type one ({ password }) or let Plejar make a strong one ({ generate: true }).
// requireChange (default true) makes them choose their own the next time they sign in.
exports.setMemberPassword = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next, 'name');
  if (!agency) return;
  const member = validId(req.params.userId) ? await User.findOne({ _id: req.params.userId, agency: agency._id }) : null;
  if (!member) return next(new AppError('No member found with that ID for this vendor.', 404));

  const generate = req.body.generate === true || req.body.generate === 'true';
  const password = generate ? temporaryPassword() : String(req.body.password || '');
  if (!generate) {
    if (password.length < 8) return next(new AppError('Use at least 8 characters for the password.', 400));
    if (password.length > 128) return next(new AppError('Use at most 128 characters for the password.', 400));
    if (req.body.confirmPassword !== undefined && req.body.confirmPassword !== password) {
      return next(new AppError("The two passwords don't match.", 400));
    }
  }
  const requireChange = req.body.requireChange !== false && req.body.requireChange !== 'false';
  const wasNew = member.accountStatus === 'invited' || member.mustChangePassword;

  member.password = password;
  member.confirmPassword = password;
  member.mustChangePassword = requireChange;
  member.$locals.temporaryPassword = requireChange;
  member.accountStatus = 'active';
  member.inviteToken = undefined;
  member.inviteExpires = undefined;
  member.passwordResetToken = undefined;
  member.passwordResetExpire = undefined;
  await member.save();

  await logActivity(req, {
    action: 'agency.password_set',
    summary: `${generate ? 'Generated' : 'Set'} a new password for ${member.name}${requireChange ? ' (must change it at next sign-in)' : ''}`,
    user: member._id,
    agency: agency._id
  });

  const loginURL = `${req.protocol}://${req.get('host')}/agent`;
  const kind = wasNew && member.agencyRole === 'owner' ? 'new' : 'changed';
  const vendorId = vendorCode(agency);
  const emailDraft = credentialsEmail({ name: member.name, agencyName: agency.name, email: member.email, password, loginURL, kind, temporary: requireChange, vendorId });

  // "Send login details": email them straight away (the admin still gets them, in case email fails)
  let emailSent = null;
  if (req.body.send === true || req.body.send === 'true') {
    try {
      await new Email(member, loginURL, { agencyName: agency.name, vendorCode: vendorId, email: member.email, password, temporary: requireChange, kind }).sendVendorLogin(emailDraft.subject);
      emailSent = true;
      member.credentialsSentAt = new Date();
      await member.save({ validateBeforeSave: false });
      await logActivity(req, { action: 'agency.login_sent', summary: `Emailed sign-in details to ${member.name} (${member.email})`, user: member._id, agency: agency._id });
    } catch (err) {
      console.warn(`[MAIL WARNING] Sign-in details to ${member.email} not sent:`, err.message);
      emailSent = false;
    }
  }

  let message = `New password set for ${member.name}. Any device they were signed in on has been signed out.`;
  if (emailSent === true) message = `Sign-in details emailed to ${member.email}. Any device they were signed in on has been signed out.`;
  if (emailSent === false) message = `The new password is set, but the email couldn't be sent (email isn't set up on the server). Send the details below yourself.`;

  res.status(200).json({
    status: 'success',
    message,
    data: {
      member: teamView(member),
      emailSent,
      credentials: { name: member.name, email: member.email, password, loginURL, vendorId, temporary: requireChange, emailDraft }
    }
  });
});

// ---------- Performance reports emailed to the vendor ----------

const periodFromQuery = q => reportPeriod(q.period, { date: q.date, month: q.month });
const siteURL = req => `${req.protocol}://${req.get('host')}`;

// Preview a report (and who it would go to) without sending it
exports.previewReport = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next);
  if (!agency) return;
  const period = periodFromQuery(req.query);
  const [report, recipients] = await Promise.all([buildReport(agency, period), reportRecipients(agency, req.query.alsoToAgencyEmail === 'true')]);
  res.status(200).json({ status: 'success', data: { report, text: reportText(report), recipients, schedule: agency.reports } });
});

exports.sendReportNow = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next);
  if (!agency) return;
  const period = periodFromQuery(req.body);
  const outcome = await sendReport(agency, period, { baseURL: siteURL(req), alsoToAgencyEmail: req.body.alsoToAgencyEmail === true || req.body.alsoToAgencyEmail === 'true' });
  if (outcome.noRecipients) return next(new AppError('This vendor has no owner email to send the report to.', 400));
  if (outcome.sentTo.length) {
    await logActivity(req, { action: 'agency.report_sent', summary: `Emailed the ${period.kind} report for ${period.label} to ${outcome.sentTo.join(', ')}`, agency: agency._id });
  }
  const sent = outcome.sentTo.length > 0;
  res.status(sent ? 200 : 502).json({
    status: sent ? 'success' : 'fail',
    message: sent
      ? `Report for ${period.label} emailed to ${outcome.sentTo.join(' and ')}.${outcome.failed.length ? ` It couldn't be sent to ${outcome.failed.map(f => f.email).join(', ')}.` : ''}`
      : "The report couldn't be emailed (email isn't set up on the server). Copy it below and send it yourself.",
    data: { sentTo: outcome.sentTo, failed: outcome.failed.map(f => f.email), report: outcome.report, text: reportText(outcome.report) }
  });
});

// Turn automatic daily or monthly reports on or off
exports.setReportSchedule = catchAsync(async (req, res, next) => {
  const agency = await findVendor(req.params.id, next);
  if (!agency) return;
  const { schedule } = req.body;
  if (!['off', 'daily', 'monthly'].includes(schedule)) return next(new AppError('Choose off, daily or monthly.', 400));
  const changed = agency.reports.schedule !== schedule;
  agency.reports.schedule = schedule;
  if (req.body.alsoToAgencyEmail !== undefined) agency.reports.alsoToAgencyEmail = req.body.alsoToAgencyEmail === true || req.body.alsoToAgencyEmail === 'true';
  agency.reports.baseURL = siteURL(req);
  agency.reports.updatedBy = req.user._id;
  if (changed) { agency.reports.lastError = ''; agency.reports.lastAttemptAt = undefined; }
  await agency.save({ validateBeforeSave: false });
  await logActivity(req, { action: 'agency.report_schedule', summary: schedule === 'off' ? 'Turned off automatic reports' : `Set ${schedule} reports to be emailed automatically`, agency: agency._id });
  const when = { off: 'Automatic reports are off.', daily: 'A report for the day before will be emailed every morning at 9:00 (Bangladesh time).', monthly: 'A report for the month before will be emailed on the 1st of each month at 9:00 (Bangladesh time).' }[schedule];
  res.status(200).json({ status: 'success', message: when, data: { schedule: agency.reports } });
});
