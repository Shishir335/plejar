// Plejar's commission on a vendor's bookings (tour agencies) and stays (hotels).
// It is off for every vendor until an admin turns it on for that vendor, as either a percent of
// each booking or a flat amount per booking. Bookings keep a snapshot of the terms they were made with.
const round = n => Math.round((n || 0) * 100) / 100;

const TYPES = ['percent', 'amount'];

// What a vendor is charged now: { type: 'none' | 'percent' | 'amount', value }
const termsFor = vendor => {
  const c = (vendor && vendor.commission) || {};
  if (!c.enabled || !(Number(c.value) > 0)) return { type: 'none', value: 0 };
  return { type: c.type === 'amount' ? 'amount' : 'percent', value: Number(c.value) };
};

// Plejar's share of `amount`. A flat amount never takes more than the booking is worth.
const commissionFor = (amount, terms) => {
  if (!terms || !(amount > 0)) return 0;
  if (terms.type === 'percent') return round((amount * terms.value) / 100);
  if (terms.type === 'amount') return round(Math.min(terms.value, amount));
  return 0;
};

// The fields a booking or stay request keeps
const snapshot = (amount, terms) => ({
  commissionType: terms.type,
  commissionRate: terms.type === 'percent' ? terms.value : 0,
  commissionFlat: terms.type === 'amount' ? terms.value : 0,
  commissionAmount: commissionFor(amount, terms)
});

// The terms a booking was made with, read back from its snapshot. Old bookings were always a percent.
const termsOf = doc => {
  const type = doc.commissionType || (doc.commissionRate > 0 ? 'percent' : 'none');
  if (type === 'amount') return { type, value: doc.commissionFlat || 0 };
  if (type === 'percent') return { type, value: doc.commissionRate || 0 };
  return { type: 'none', value: 0 };
};

const taka = n => `৳${Number(n).toLocaleString('en-IN')}`;
const describe = terms => {
  if (terms.type === 'percent') return `${terms.value}% of each booking`;
  if (terms.type === 'amount') return `${taka(terms.value)} per booking`;
  return 'Off';
};

// What the admin panel shows for a vendor
const commissionView = vendor => {
  const c = (vendor && vendor.commission) || {};
  const terms = termsFor(vendor);
  return {
    enabled: terms.type !== 'none',
    type: c.type === 'amount' ? 'amount' : 'percent',
    value: Number(c.value) || 0,
    label: describe(terms),
    changedAt: c.changedAt || null
  };
};

module.exports = { TYPES, termsFor, commissionFor, snapshot, termsOf, describe, commissionView };
