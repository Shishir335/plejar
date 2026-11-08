const validator = require('validator');
const AgentLead = require('../models/agentLeadModel');
const User = require('../models/userModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { savePrivateDocument, removePrivateFolder } = require('../utils/uploads');
const { normalizePhone } = require('../utils/registration');
const { OPEN_STATUSES, folderFor, statusURL, mail } = require('./applicationController');
const membership = require('../utils/vendorMembership');
const { contactInfo } = require('./helpController');

/**
 * "Travel Agency Application" in the traveler app (/api/v1/agency-application): the Become a Partner
 * page, the 3-step form (agency information, business details, documents) and the traveler's own
 * applications. Applications land in the admin's Membership applications list like website ones.
 */

const { APP_OPTIONS } = AgentLead;
const COUNTRIES = ['Bangladesh', 'India', 'Nepal', 'Bhutan', 'Sri Lanka', 'Maldives', 'Myanmar', 'Thailand', 'Malaysia', 'Singapore', 'Indonesia',
  'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'United Kingdom', 'United States', 'Canada', 'Australia', 'Other'];
// The three uploads on step 3, and the document kind each one is stored as
const FILES = { businessLicense: 'trade_license', insurance: 'insurance', taxId: 'tax_id' };
const FILE_LABELS = { businessLicense: 'Business License or Registration', insurance: 'Proof of Insurance', taxId: 'Tax ID or Business Number' };

const options = group => Object.entries(APP_OPTIONS[group]).map(([key, label]) => ({ key, label }));
const text = (v, max = 300) => {
  const first = Array.isArray(v) ? v[0] : v;
  return first == null ? '' : String(first).trim().slice(0, max);
};
// specializations may come as an array, "a,b" or a JSON array (multipart forms)
const listOf = v => {
  if (Array.isArray(v)) return v.map(String);
  const raw = String(v || '').trim();
  if (raw.startsWith('[')) {
    try { return JSON.parse(raw).map(String); } catch (e) { return []; }
  }
  return raw ? raw.split(',').map(s => s.trim()) : [];
};

const BENEFITS = [
  { icon: 'trending', title: 'Exclusive Rates', text: 'Access special rates and offers not available to the general public.' },
  { icon: 'globe', title: 'Global Network', text: 'Join our network of travel agencies and reach travelers across Bangladesh and beyond.' },
  { icon: 'support', title: 'Dedicated Support', text: 'Get priority access to our dedicated agency support team.' },
  { icon: 'shield', title: 'Secure Platform', text: 'Operate on our secure, reliable booking platform with advanced features.' }
];
const REQUIREMENTS = [
  'Valid business license or registration',
  'Minimum of 1 year in operation',
  'Professional website or social media presence',
  'Liability insurance',
  'References from clients or industry partners'
];
const PROCESS = [
  { step: 1, title: 'Complete Application', text: 'Fill out our application form with details about your agency.' },
  { step: 2, title: 'Document Verification', text: 'Submit required documents for verification and review.' },
  { step: 3, title: 'Interview', text: 'Schedule a brief interview with our partnership team.' },
  { step: 4, title: 'Approval & Setup', text: 'Once approved, set up your account and start taking bookings!' }
];
const TIPS = [
  { title: 'Be thorough', text: 'Complete all fields with accurate information to avoid delays in processing.' },
  { title: 'Documentation', text: 'Ensure all uploaded documents are clear, current, and match the information provided in the form.' },
  { title: 'Highlight expertise', text: "Emphasize your agency's specializations and unique selling points in the additional information section." },
  { title: 'References', text: 'Be prepared to provide references from clients or industry partners if requested during the review process.' }
];

// What the traveler sees about their own application
const myView = lead => ({
  _id: lead._id,
  reference: lead.reference,
  agencyName: lead.agencyName,
  status: lead.status === 'contacted' ? 'reviewing' : lead.status,
  submittedAt: lead.createdAt,
  decidedAt: lead.decidedAt || null,
  rejectedReason: lead.status === 'rejected' ? lead.rejectedReason : '',
  documents: lead.documents.map(d => ({ kind: d.kind, name: d.originalName, uploadedAt: d.uploadedAt })),
  messages: lead.messages.map(m => ({ from: m.from, text: m.text, at: m.at })),
  canReply: lead.status === 'needs_info',
  // Approved: the agency signs in to the vendor panel with the contact email
  vendorLogin: lead.status === 'approved' ? { email: lead.email, url: '/agent' } : null
});

/** GET /agency-application — the Become a Partner page, form choices and the traveler's applications */
exports.overview = catchAsync(async (req, res) => {
  const [contact, mine] = await Promise.all([
    contactInfo(),
    req.user ? AgentLead.find({ applicant: req.user._id }).sort({ createdAt: -1 }).limit(5) : []
  ]);
  const open = mine.find(l => OPEN_STATUSES.includes(l.status) && l.vendorType !== 'hotel');
  res.status(200).json({
    status: 'success',
    data: {
      hero: {
        title: 'Become a Partner Agency',
        text: 'Expand your business opportunities and offer your clients the best travel experiences with our comprehensive agency program.',
        cta: 'Apply Now'
      },
      benefits: BENEFITS,
      requirements: REQUIREMENTS,
      process: PROCESS,
      processNote: 'The typical application process takes 5-7 business days from submission to approval.',
      tips: TIPS,
      assistance: {
        text: 'If you have questions about the application process or need help completing the form, our partnership team is here to assist you.',
        email: contact.partnerEmail,
        phone: contact.partnerPhone
      },
      form: {
        steps: [
          { step: 1, key: 'agency', title: 'Agency Information' },
          { step: 2, key: 'business', title: 'Business Details' },
          { step: 3, key: 'documents', title: 'Documentation' }
        ],
        businessTypes: options('businessTypes'),
        countries: COUNTRIES,
        annualSales: options('annualSales'),
        employees: options('employees'),
        annualClients: options('annualClients'),
        specializations: options('specializations'),
        heardFrom: options('heardFrom'),
        documents: Object.keys(FILES).map(key => ({ key, label: FILE_LABELS[key], required: true })),
        fileTypes: ['PDF', 'JPG', 'PNG'],
        maxFileSizeMb: 5,
        legal: { terms: '/api/v1/pages/terms', privacy: '/api/v1/pages/privacy' }
      },
      canApply: !open,
      openApplication: open ? myView(open) : null,
      myApplications: mine.map(myView)
    }
  });
});

// Step 1: agency information. Returns { errors, values }
const agencyStep = async (b, user) => {
  const errors = {};
  const country = text(b.country, 60) || 'Bangladesh';
  const values = {
    agencyName: text(b.agencyName, 120),
    website: text(b.website, 200),
    yearStarted: text(b.yearEstablished, 4),
    businessType: text(b.businessType, 40),
    officeAddress: text(b.streetAddress, 300),
    city: text(b.city, 80),
    stateProvince: text(b.stateProvince, 80),
    postalCode: text(b.postalCode, 20),
    country,
    contactName: text(b.contactName, 80),
    contactRole: text(b.jobTitle, 60),
    email: text(b.email, 200).toLowerCase(),
    phone: text(b.phone, 30)
  };
  const thisYear = new Date().getFullYear();
  if (values.agencyName.length < 2) errors.agencyName = 'Enter your agency name.';
  if (values.website && !validator.isURL(values.website, { require_protocol: false })) errors.website = 'Enter a web address, for example https://youragency.com.';
  if (!/^\d{4}$/.test(values.yearStarted) || Number(values.yearStarted) < 1950 || Number(values.yearStarted) > thisYear) errors.yearEstablished = `Enter the year your agency started, between 1950 and ${thisYear}.`;
  if (!APP_OPTIONS.businessTypes[values.businessType]) errors.businessType = 'Select your business type.';
  if (!values.officeAddress) errors.streetAddress = 'Enter the street address.';
  if (!values.city) errors.city = 'Enter the city.';
  if (!values.stateProvince) errors.stateProvince = 'Enter the state, province or division.';
  if (!values.postalCode) errors.postalCode = 'Enter the postal code.';
  else if (country === 'Bangladesh' && !/^\d{4}$/.test(values.postalCode)) errors.postalCode = 'Bangladeshi postal codes have 4 digits, for example 1209.';
  if (!COUNTRIES.includes(country)) errors.country = 'Select a country.';
  if (values.contactName.length < 2) errors.contactName = 'Enter the contact name.';
  if (!values.contactRole) errors.jobTitle = 'Enter the job title.';
  if (!validator.isEmail(values.email)) errors.email = 'Enter a valid email address.';
  if (country === 'Bangladesh') {
    const phone = normalizePhone(values.phone);
    if (!phone) errors.phone = 'Enter a Bangladeshi mobile number, for example 01712345678.';
    else values.phone = phone;
  } else if (!/^\+?[\d\s()-]{7,20}$/.test(values.phone)) errors.phone = 'Enter a phone number with the country code, for example +44 20 7946 0000.';

  // The contact email becomes the owner's vendor login. Your own email is fine (your account then
  // works in the vendor panel too); someone else's account isn't.
  if (!errors.email) {
    const account = await User.findOne({ email: values.email }).setOptions({ includeInactive: true }).select('_id agency hotelAgency');
    if (account && !(user && String(account._id) === String(user._id))) errors.email = "This email belongs to another Plejar account. Use your own email or your agency's business email.";
    // The app applies for tour agencies; an account that runs a hotel can add one tour agency
    else if (account && await membership.cannotLink(account, 'agency')) errors.email = 'Your account already belongs to a tour agency on Plejar.';
  }
  if (!errors.email || user) {
    const open = await AgentLead.findOne({
      status: { $in: OPEN_STATUSES },
      vendorType: { $ne: 'hotel' },
      $or: [{ email: values.email }, ...(user ? [{ applicant: user._id }] : [])]
    }).select('reference');
    if (open) errors.agencyName = `You already have an application being reviewed (${open.reference}). Follow it in My Account.`;
  }
  values.yearStarted = errors.yearEstablished ? undefined : Number(values.yearStarted);
  return { errors, values };
};

// Step 2: business details
const businessStep = b => {
  const errors = {};
  const values = {
    annualSales: text(b.annualSales, 20),
    employees: text(b.employees, 20),
    annualClients: text(b.annualClients, 20),
    specializations: [...new Set(listOf(b.specializations))],
    partnerships: text(b.partnerships, 1000),
    heardFrom: text(b.heardFrom, 20)
  };
  if (!APP_OPTIONS.annualSales[values.annualSales]) errors.annualSales = 'Select your annual sales volume.';
  if (!APP_OPTIONS.employees[values.employees]) errors.employees = 'Select the number of employees.';
  if (!APP_OPTIONS.annualClients[values.annualClients]) errors.annualClients = 'Select how many clients you serve a year.';
  if (!values.specializations.length) errors.specializations = 'Select at least one travel specialization.';
  else if (values.specializations.some(s => !APP_OPTIONS.specializations[s])) errors.specializations = 'Choose specializations from the list.';
  if (!APP_OPTIONS.heardFrom[values.heardFrom]) errors.heardFrom = 'Tell us how you heard about us.';
  return { errors, values, about: text(b.additionalInfo, 1500) };
};

const fieldErrors = (res, errors) => res.status(400).json({ status: 'fail', message: Object.values(errors)[0], errors });

/** POST /agency-application/check { step: 1|2, ...fields } — check a step before going to the next */
exports.checkStep = catchAsync(async (req, res) => {
  const step = Number(req.body.step);
  if (![1, 2].includes(step)) return fieldErrors(res, { step: 'Send step 1 or 2.' });
  const { errors } = step === 1 ? await agencyStep(req.body, req.user) : businessStep(req.body);
  if (Object.keys(errors).length) return fieldErrors(res, errors);
  res.status(200).json({ status: 'success', data: { step, valid: true, next: step + 1 } });
});

/**
 * POST /agency-application (multipart) — every field from the three steps, the files
 * businessLicense, insurance and taxId, and agreedToTerms=true. Errors come back per field.
 */
exports.submit = catchAsync(async (req, res) => {
  const [agency, business] = [await agencyStep(req.body, req.user), businessStep(req.body)];
  const errors = { ...agency.errors, ...business.errors };
  const files = req.files || {};
  Object.keys(FILES).forEach(key => {
    if (!files[key] || !files[key][0]) errors[key] = `Upload your ${FILE_LABELS[key].toLowerCase()}.`;
  });
  if (!['true', 'on', '1'].includes(text(req.body.agreedToTerms).toLowerCase())) errors.agreedToTerms = 'Please confirm the information is accurate and agree to the Terms and Conditions and Privacy Policy.';
  if (Object.keys(errors).length) return fieldErrors(res, errors);

  const v = agency.values;
  const lead = new AgentLead({
    ...v,
    district: v.stateProvince,
    regions: [v.city, v.stateProvince].filter(Boolean).join(', '),
    about: business.about,
    business: business.values,
    source: 'app',
    applicant: req.user._id,
    agreedToTerms: true,
    agreedAt: new Date(),
    ipAddress: req.ip || ''
  });
  await lead.validate();
  try {
    lead.documents = await Promise.all(Object.entries(FILES).map(async ([key, kind]) => {
      const file = files[key][0];
      return { kind, file: await savePrivateDocument(file, folderFor(lead)), originalName: String(file.originalname || '').slice(0, 150), mimeType: file.mimetype, size: file.size };
    }));
    await lead.save();
  } catch (err) {
    await removePrivateFolder(folderFor(lead));
    throw err;
  }
  const emailSent = await mail(lead, statusURL(req, lead), m => m.sendApplicationReceived());
  res.status(201).json({
    status: 'success',
    message: `Thanks, ${lead.contactName}. Your application is in. The review usually takes 5-7 business days.`,
    data: { application: myView(lead), emailSent }
  });
});

// GET /agency-application/mine
exports.mine = catchAsync(async (req, res) => {
  const rows = await AgentLead.find({ applicant: req.user._id }).sort({ createdAt: -1 });
  res.status(200).json({ status: 'success', data: { applications: rows.map(myView) } });
});

/**
 * POST /agency-application/:reference/reply (multipart: message, and files trade_license, insurance,
 * tax_id, other) — answer Plejar's request for more information. Hands over to the website's reply.
 */
exports.findMineForReply = catchAsync(async (req, res, next) => {
  const reference = text(req.params.reference, 20).toUpperCase();
  const lead = await AgentLead.findOne({ reference, applicant: req.user._id }).select('reference email');
  if (!lead) return next(new AppError('No application of yours has that reference.', 404));
  req.body.reference = lead.reference;
  req.body.email = lead.email;
  next();
});
