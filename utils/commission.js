const { getSetting } = require('./settings');

// Platform commission, as a percentage of the booking amount.
// A vendor can have its own rate (agency.commissionRate); otherwise the platform default applies.
const FALLBACK_RATE = Number(process.env.DEFAULT_COMMISSION_RATE) || 10;

const getDefaultRate = async () => {
  const rate = Number(await getSetting('commissionRate', FALLBACK_RATE));
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : FALLBACK_RATE;
};

const isCustom = agency => typeof (agency && agency.commissionRate) === 'number';

const rateFor = async agency => (isCustom(agency) ? agency.commissionRate : getDefaultRate());

const commissionFor = (amount, rate) => Math.round(((amount * rate) / 100) * 100) / 100;

module.exports = { FALLBACK_RATE, getDefaultRate, isCustom, rateFor, commissionFor };
