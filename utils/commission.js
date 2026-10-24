// Platform commission, as a percentage of the booking amount.
// A vendor can have its own rate (agency.commissionRate); otherwise the platform default applies.
const DEFAULT_RATE = Number(process.env.DEFAULT_COMMISSION_RATE) || 10;

const rateFor = agency => {
  const own = agency && agency.commissionRate;
  return typeof own === 'number' && own >= 0 && own <= 100 ? own : DEFAULT_RATE;
};

const commissionFor = (amount, rate) => Math.round(((amount * rate) / 100) * 100) / 100;

module.exports = { DEFAULT_RATE, rateFor, commissionFor };
