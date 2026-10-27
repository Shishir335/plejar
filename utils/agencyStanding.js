/**
 * Explain why an agency can't use its panel right now, or return null when it can.
 * A suspension with an end date lifts itself once that date has passed.
 */
const agencyBlockedReason = async agency => {
  if (!agency) return 'Your agency could not be found. Contact Plejar support.';
  if (agency.status === 'active' || !agency.status) return null;

  if (agency.status === 'suspended' && agency.statusUntil && agency.statusUntil <= new Date() && typeof agency.save === 'function') {
    agency.status = 'active';
    agency.statusReason = '';
    agency.statusUntil = undefined;
    await agency.save({ validateBeforeSave: false });
    return null;
  }

  const until = agency.statusUntil ? ` until ${agency.statusUntil.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
  const why = agency.statusReason ? ` Reason: ${agency.statusReason.replace(/[.\s]+$/, '')}.` : '';
  return agency.status === 'suspended'
    ? `Your agency account is suspended${until}.${why} Contact Plejar support.`
    : `Your agency account is deactivated.${why} Contact Plejar support to reactivate it.`;
};

module.exports = { agencyBlockedReason };
