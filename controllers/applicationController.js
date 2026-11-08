const AgentLead = require('../models/agentLeadModel');
const { STAY_TYPES } = require('../models/hotelModel');
const User = require('../models/userModel');
const VendorCategory = require('../models/vendorCategoryModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Email = require('../utils/email');
const { escapeRegex } = require('../utils/query');
const { savePrivateDocument, removePrivateFolder } = require('../utils/uploads');

// Bangladeshi mobile numbers: 01XXXXXXXXX, optionally with +880 / 880 prefix
const BD_PHONE = /^(?:\+?880|0)1[3-9]\d{8}$/;

// Applications still waiting on a decision; a second one from the same agency is refused
const OPEN_STATUSES = ['new', 'reviewing', 'needs_info', 'contacted'];

const text = value => {
  const first = Array.isArray(value) ? value[0] : value;
  return first == null ? '' : String(first).trim();
};

// "" stays empty; anything else must be a whole number
const whole = value => (value === '' ? undefined : Number(value));

// What a hotel tells us on top of the shared fields; its draft listing starts from these
const readHotel = b => ({
  stayType: text(b.stayType),
  rooms: whole(text(b.rooms)),
  starRating: whole(text(b.starRating)),
  pricePerNight: whole(text(b.pricePerNight).replace(/[,\s]/g, '')),
  checkIn: text(b.checkIn),
  checkOut: text(b.checkOut)
});

const hotelProblem = (hotel, values) => {
  if (!values.officeAddress) return "Enter the hotel's address.";
  if (!STAY_TYPES.includes(hotel.stayType)) return 'Choose the kind of stay.';
  if (hotel.pricePerNight === undefined) return 'Enter the lowest price per night.';
  if (!Number.isInteger(hotel.pricePerNight) || hotel.pricePerNight < 0) return 'Enter the price per night in taka, for example 3500.';
  if (hotel.rooms !== undefined && !Number.isInteger(hotel.rooms)) return 'Enter how many rooms you have, for example 24.';
  if (hotel.starRating !== undefined && ![1, 2, 3, 4, 5].includes(hotel.starRating)) return 'Choose a star rating from 1 to 5.';
  return null;
};

const folderFor = lead => `application-${lead._id}`;

const statusURL = (req, lead) => `${req.protocol}://${req.get('host')}/apply/status?ref=${encodeURIComponent(lead.reference)}`;

// Save every uploaded file privately and describe it for the application record
const storeFiles = (files, lead) => {
  const uploads = AgentLead.DOCUMENT_KINDS.flatMap(kind => ((files && files[kind]) || []).map(file => ({ kind, file })));
  return Promise.all(uploads.map(async ({ kind, file }) => ({
    kind,
    file: await savePrivateDocument(file, folderFor(lead)),
    originalName: String(file.originalname || '').slice(0, 150),
    mimeType: file.mimetype,
    size: file.size
  })));
};

// Mail problems must never lose an application, so failures are only logged
const mail = async (lead, url, send) => {
  try {
    await send(new Email({ email: lead.email, name: lead.contactName }, url, { agencyName: lead.agencyName, reference: lead.reference }));
    return true;
  } catch (err) {
    console.warn(`[MAIL WARNING] Application email to ${lead.email} not sent:`, err.message);
    return false;
  }
};

// What the applicant may see about their own application (never internal notes or who reviewed it)
const publicView = lead => ({
  reference: lead.reference,
  vendorType: lead.vendorType || 'agency',
  agencyName: lead.agencyName,
  contactName: lead.contactName,
  status: lead.status === 'contacted' ? 'reviewing' : lead.status,
  submittedAt: lead.createdAt,
  decidedAt: lead.decidedAt,
  rejectedReason: lead.status === 'rejected' ? lead.rejectedReason : '',
  documents: lead.documents.map(d => ({ kind: d.kind, name: d.originalName, uploadedAt: d.uploadedAt })),
  messages: lead.messages.map(m => ({ from: m.from, text: m.text, at: m.at })),
  canReply: lead.status === 'needs_info'
});

// Categories an applicant can pick from (the ones the admin has switched on)
exports.listCategories = catchAsync(async (req, res) => {
  const categories = await VendorCategory.find({ active: true }).sort({ name: 1 }).select('name description').lean();
  res.status(200).json({ status: 'success', data: { categories } });
});

// PUBLIC: A tour agency or a hotel applies for membership (vendorType: agency | hotel)
exports.createApplication = catchAsync(async (req, res, next) => {
  const b = req.body;
  const vendorType = text(b.vendorType) || 'agency';
  if (!AgentLead.VENDOR_TYPES.includes(vendorType)) return next(new AppError('Choose whether you are a tour agency or a hotel.', 400));
  const isHotel = vendorType === 'hotel';
  const values = {
    agencyName: text(b.agencyName),
    tradeLicenseNumber: text(b.tradeLicenseNumber),
    yearStarted: text(b.yearStarted) ? Number(text(b.yearStarted)) : undefined,
    teamSize: text(b.teamSize) || undefined,
    officeAddress: text(b.officeAddress),
    district: text(b.district),
    regions: text(b.regions),
    website: text(b.website),
    about: text(b.about),
    contactName: text(b.contactName),
    contactRole: text(b.contactRole),
    phone: text(b.phone).replace(/[\s-]/g, ''),
    email: text(b.email).toLowerCase(),
    message: text(b.message)
  };

  if (!values.agencyName) return next(new AppError(isHotel ? 'Enter your hotel name.' : 'Enter your agency name.', 400));
  if (!values.tradeLicenseNumber) return next(new AppError('Enter your trade license number.', 400));
  if (!values.contactName) return next(new AppError('Enter your name.', 400));
  if (!BD_PHONE.test(values.phone)) return next(new AppError('Enter a Bangladeshi mobile number, for example 01712345678.', 400));
  if (values.yearStarted !== undefined && !Number.isInteger(values.yearStarted)) return next(new AppError(`Enter the year your ${isHotel ? 'hotel' : 'agency'} started, for example 2018.`, 400));
  const hotel = isHotel ? readHotel(b) : undefined;
  if (isHotel) {
    const problem = hotelProblem(hotel, values);
    if (problem) return next(new AppError(problem, 400));
    // A hotel isn't asked where it runs tours or what kinds of tours
    values.regions = '';
  }

  const files = req.files || {};
  if (!files.trade_license || !files.trade_license.length) return next(new AppError('Upload a photo or PDF of your trade license.', 400));
  if (!files.nid || !files.nid.length) return next(new AppError("Upload the owner's national ID card.", 400));
  if (text(b.agreedToTerms) !== 'true') return next(new AppError('Please confirm the details are true and agree to the member terms.', 400));

  // One open application per agency
  const open = await AgentLead.findOne({
    status: { $in: OPEN_STATUSES },
    $or: [
      { email: values.email },
      { tradeLicenseNumber: { $regex: `^${escapeRegex(values.tradeLicenseNumber)}$`, $options: 'i' } }
    ]
  }).select('_id');
  if (open) {
    return next(new AppError(`We already have an application for this ${isHotel ? 'hotel' : 'agency'} that is being reviewed. Check it with the reference number we emailed you.`, 409));
  }
  // One person, one login: someone who already uses Plejar applies with the same email, and the
  // vendor role is added to that account when an admin accepts. Only one agency per account, though.
  const account = await User.findOne({ email: values.email }).setOptions({ includeInactive: true }).select('agency status deletedAt active');
  if (account && account.agency) {
    return next(new AppError('This email already belongs to an agency on Plejar. Apply with a different email, or contact us if you want to change agencies.', 409));
  }
  if (account && (account.deletedAt || account.active === false || account.status !== 'active')) {
    return next(new AppError("The Plejar account with this email isn't active. Contact Plejar support, or apply with a different email.", 409));
  }

  // Only categories the admin has switched on
  const wanted = isHotel ? [] : [].concat(b.categories || []).map(String).filter(id => /^[a-f\d]{24}$/i.test(id));
  const categories = wanted.length
    ? (await VendorCategory.find({ _id: { $in: wanted }, active: true }).select('_id')).map(c => c._id)
    : [];

  const lead = new AgentLead({ ...values, vendorType, ...(isHotel ? { hotel } : {}), categories, agreedToTerms: true, agreedAt: new Date(), ipAddress: req.ip || '' });
  await lead.validate();
  try {
    lead.documents = await storeFiles(files, lead);
    await lead.save();
  } catch (err) {
    await removePrivateFolder(folderFor(lead));
    throw err;
  }

  const emailSent = await mail(lead, statusURL(req, lead), m => m.sendApplicationReceived());

  res.status(201).json({
    status: 'success',
    message: `Thanks, ${lead.contactName}. Your application is in. Our team will review it within 3 working days.`,
    data: { reference: lead.reference, agencyName: lead.agencyName, emailSent, submittedAt: lead.createdAt }
  });
});

// Find an application from the reference and email the applicant gave us
const findOwn = async (body, next) => {
  const reference = text(body.reference).toUpperCase();
  const email = text(body.email).toLowerCase();
  const lead = reference && email ? await AgentLead.findOne({ reference, email }) : null;
  if (!lead) next(new AppError('No application matches that reference number and email. Check both and try again.', 404));
  return lead;
};

// PUBLIC: Check an application's progress
exports.checkStatus = catchAsync(async (req, res, next) => {
  const lead = await findOwn(req.body, next);
  if (!lead) return;
  res.status(200).json({ status: 'success', data: { application: publicView(lead) } });
});

// PUBLIC: Answer our request for more information, optionally with more documents
exports.reply = catchAsync(async (req, res, next) => {
  const lead = await findOwn(req.body, next);
  if (!lead) return;
  if (lead.status !== 'needs_info') {
    return next(new AppError("We haven't asked for anything else on this application, so there is nothing to reply to.", 400));
  }

  const message = text(req.body.message);
  const files = req.files || {};
  const hasFiles = AgentLead.DOCUMENT_KINDS.some(kind => files[kind] && files[kind].length);
  if (!message && !hasFiles) return next(new AppError('Write a reply or add a document.', 400));
  if (message.length > 2000) return next(new AppError('Keep your reply under 2000 characters.', 400));

  const added = await storeFiles(files, lead);
  lead.documents.push(...added);
  const note = added.length ? `${message ? `${message}\n\n` : ''}Added ${added.length} document${added.length === 1 ? '' : 's'}.` : message;
  lead.messages.push({ from: 'applicant', text: note, byName: lead.contactName });
  lead.status = 'reviewing';
  lead.unreadReply = true;
  await lead.save();

  res.status(200).json({
    status: 'success',
    message: 'Thanks, your reply is with our team.',
    data: { application: publicView(lead) }
  });
});

exports.OPEN_STATUSES = OPEN_STATUSES;
exports.folderFor = folderFor;
exports.statusURL = statusURL;
exports.mail = mail;
