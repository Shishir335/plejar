const AgentLead = require('../models/agentLeadModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

// Bangladeshi mobile numbers: 01XXXXXXXXX, optionally with +880 / 880 prefix
const BD_PHONE = /^(?:\+?880|0)1[3-9]\d{8}$/;

// 1. PUBLIC: Tour agent submits their details to be contacted
exports.createLead = catchAsync(async (req, res, next) => {
  const { agencyName, contactName, phone, email, regions, website, message } = req.body;

  const cleanPhone = String(phone || '').replace(/[\s-]/g, '');
  if (!BD_PHONE.test(cleanPhone)) {
    return next(new AppError('Enter a Bangladeshi mobile number, for example 01712345678.', 400));
  }

  const lead = await AgentLead.create({
    agencyName,
    contactName,
    phone: cleanPhone,
    email,
    regions,
    website,
    message,
    ipAddress: req.ip || ''
  });

  res.status(201).json({
    status: 'success',
    message: `Thanks, ${lead.contactName}. Our team will contact you within 2 working days.`,
    data: {
      lead: {
        id: lead._id,
        agencyName: lead.agencyName,
        createdAt: lead.createdAt
      }
    }
  });
});

// 2. ADMIN: List agent leads, newest first
exports.getAllLeads = catchAsync(async (req, res, next) => {
  const query = {};
  if (req.query.status) {
    query.status = req.query.status;
  }

  const leads = await AgentLead.find(query).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: leads.length,
    data: {
      leads
    }
  });
});

// 3. ADMIN: Mark a lead as contacted or archived
exports.updateLeadStatus = catchAsync(async (req, res, next) => {
  const lead = await AgentLead.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true, runValidators: true }
  );

  if (!lead) {
    return next(new AppError('No agent lead found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      lead
    }
  });
});

// 4. ADMIN: Delete a lead
exports.deleteLead = catchAsync(async (req, res, next) => {
  const lead = await AgentLead.findByIdAndDelete(req.params.id);

  if (!lead) {
    return next(new AppError('No agent lead found with that ID', 404));
  }

  res.status(204).json({
    status: 'success',
    data: null
  });
});
