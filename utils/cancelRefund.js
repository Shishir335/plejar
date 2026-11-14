/**
 * A tour's or hotel's cancellation refund: { days, percent }. A traveler who cancels a confirmed booking
 * (or accepted stay) at least `days` days before it starts gets `percent` of the booking money back;
 * later than that, none. Without one, none once confirmed. Saved on each booking as it was then.
 */
const AppError = require('./appError');

/** The saved refund as { days, percent }, or null when there is none */
const cancelRefundOf = source => {
  const p = source && source.cancelRefund;
  return p && p.days >= 1 && p.percent >= 0 ? { days: Math.round(p.days), percent: Math.round(p.percent) } : null;
};

/**
 * What an agent or hotel entered: { days, percent }, with both empty (or null) meaning no refund once
 * confirmed. Throws an AppError (400) when only one is given or a value is out of range.
 */
const parseCancelRefund = value => {
  if (value == null || value === '') return null;
  if (typeof value !== 'object') throw new AppError('Enter the cancellation refund as days and a percent.', 400);
  const blank = v => v == null || String(v).trim() === '';
  if (blank(value.days) && blank(value.percent)) return null;
  if (blank(value.days) || blank(value.percent)) throw new AppError('For the cancellation refund, enter both the days before and the percent back (or leave both empty).', 400);
  const days = Number(value.days);
  const percent = Number(value.percent);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new AppError('Cancellation refund: the days before must be a whole number from 1 to 365.', 400);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new AppError('Cancellation refund: the percent back must be a whole number from 0 to 100.', 400);
  return { days, percent };
};

/** How it is said to travelers */
const cancelRefundText = policy => {
  if (!policy || policy.percent === 0) return 'Not refunded once confirmed.';
  const days = `${policy.days} day${policy.days === 1 ? '' : 's'}`;
  return `Cancel at least ${days} before: ${policy.percent}% back. Later: not refunded.`;
};

/** For tour and hotel pages: { days, percent, text }, or null */
const cancelRefundView = source => {
  const policy = cancelRefundOf(source);
  return policy ? { ...policy, text: cancelRefundText(policy) } : null;
};

module.exports = { cancelRefundOf, parseCancelRefund, cancelRefundText, cancelRefundView };
