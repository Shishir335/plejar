const User = require('../models/userModel');
const { ownerOf } = require('./vendorMembership');
const Email = require('./email');
const { buildReport } = require('./vendorReport');

// Who a vendor's report goes to: the owner, and the agency's public email if asked and different
const reportRecipients = async (agency, alsoToAgencyEmail) => {
  const owner = await User.findOne(ownerOf(agency._id)).select('name email');
  const list = owner ? [{ name: owner.name, email: owner.email }] : [];
  if (alsoToAgencyEmail && agency.email && !list.some(r => r.email === agency.email)) list.push({ name: agency.name, email: agency.email });
  return list;
};

/**
 * Build and email one report. Returns { report, sentTo, failed }.
 * `baseURL` is where the vendor panel lives (for the button in the email).
 */
const sendReport = async (agency, period, { baseURL, alsoToAgencyEmail = false } = {}) => {
  const report = await buildReport(agency, period);
  const recipients = await reportRecipients(agency, alsoToAgencyEmail);
  if (!recipients.length) return { report, sentTo: [], failed: [], noRecipients: true };
  const subject = `${agency.name}: ${period.kind === 'daily' ? 'daily' : 'monthly'} report for ${period.label}`;
  const results = await Promise.all(recipients.map(async r => {
    try {
      await new Email(r, `${baseURL}/agent`, { report }).sendVendorReport(subject);
      return { ...r, ok: true };
    } catch (err) {
      return { ...r, ok: false, error: err.message };
    }
  }));
  return { report, sentTo: results.filter(r => r.ok).map(r => r.email), failed: results.filter(r => !r.ok) };
};

module.exports = { sendReport, reportRecipients };
