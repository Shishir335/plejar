const mongoose = require('mongoose');
const User = require('../models/userModel');
const Booking = require('../models/bookingModel');
const WalletTransaction = require('../models/walletTransactionModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const geo = require('../data/bangladesh');
const { AREAS } = require('../data/bangladeshAreas');
const { photoURL } = require('../utils/social');
const { pointsSummary } = require('../utils/rewards');

// The Account screen (profile section): the screen itself, addresses, interests, transaction history

const MAX_ADDRESSES = 10;
const INTERESTS = [
  { key: 'travel', label: 'Travel' },
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'tour', label: 'Tour' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'place', label: 'Place' },
  { key: 'food', label: 'Food' },
  { key: 'games', label: 'Games' },
  { key: 'travel_group', label: 'Travel Group' }
];

const item = (key, label, icon, api, extra = {}) => ({ key, label, icon, api, ...extra });

/** GET /me/account — the Account screen: name, photo and occupation, and its three lists */
exports.account = catchAsync(async (req, res) => {
  const u = req.user;
  const { balance } = await pointsSummary(u._id);
  res.status(200).json({
    status: 'success',
    data: {
      header: {
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name,
        photoUrl: photoURL(u.photo),
        occupation: u.occupation || '',
        // The camera badge on the photo uploads here (multipart field "photo")
        photoUpload: { method: 'PATCH', api: '/api/v1/me/profile', field: 'photo' }
      },
      sections: [
        {
          key: 'my_account',
          title: 'My Account',
          items: [
            item('profile', 'Profile', 'user', '/api/v1/me/profile'),
            item('address', 'Address', 'location', '/api/v1/me/addresses', { count: (u.addresses || []).length }),
            item('interests', 'My interest', 'heart', '/api/v1/me/interests', { count: (u.interests || []).length }),
            item('promo_code', 'Get Promo Code', 'tag', '/api/v1/me/referrals'),
            item('settings', 'Setting', 'settings', '/api/v1/me/settings'),
            item('orders', 'My Order', 'gift', '/api/v1/bookings/mine'),
            item('transactions', 'Transaction History', 'card', '/api/v1/me/transactions')
          ]
        },
        {
          key: 'rewards',
          title: 'Rewards & Promotion',
          points: balance,
          items: [
            item('apply_promo', 'Apply Promo', 'promo', '/api/v1/vouchers/usable'),
            item('promo_input', 'Have a Promo code', 'code', '/api/v1/vouchers/apply-code', { method: 'POST', field: 'code' }),
            item('vouchers', 'Voucher', 'voucher', '/api/v1/vouchers')
          ]
        },
        {
          key: 'help',
          title: 'Help center',
          items: [
            item('help_center', 'Help center', 'help', '/api/v1/help'),
            item('privacy_policy', 'Privacy Policy', 'shield', '/api/v1/pages/privacy'),
            item('terms', 'Terms Of Use', 'document', '/api/v1/pages/terms')
          ]
        }
      ],
      logout: { label: 'Log out', api: '/api/v1/auth/logout', method: 'POST' }
    }
  });
});

// ---------- Address ----------

const districtList = () => geo.divisions.flatMap(d => d.districts.map(x => ({ code: x.code, name: x.name, nameBn: x.nameBn, division: d.name })))
  .sort((a, b) => a.name.localeCompare(b.name));

const areasFor = code => {
  const found = geo.findDistrict(code);
  return found ? { ...found, areas: AREAS[found.district.slug] || [] } : null;
};

const addressView = a => ({
  _id: a._id,
  label: a.label,
  district: { code: a.districtCode, name: a.district },
  division: a.division,
  area: a.area,
  address: a.line,
  fullAddress: [a.line, a.area, a.district].filter(Boolean).join(', '),
  isDefault: a.isDefault
});

// Keep the one-line `address` (shown on the profile) the same as the default address
const syncDefault = user => {
  const list = user.addresses || [];
  if (list.length && !list.some(a => a.isDefault)) list[0].isDefault = true;
  const def = list.find(a => a.isDefault);
  user.address = def ? [def.line, def.area, def.district].join(', ') : user.address;
};

const readAddress = b => {
  const errors = {};
  const place = areasFor(String(b.district || b.districtCode || ''));
  const area = String(b.area || '').trim();
  const line = String(b.address || b.line || '').trim().replace(/\s+/g, ' ');
  if (!place) errors.district = 'Select a district.';
  else if (!place.areas.includes(area)) errors.area = 'Select an area in this district.';
  if (line.length < 3) errors.address = 'Type the house, flat no and road.';
  else if (line.length > 200) errors.address = 'Keep the address under 200 characters.';
  return {
    errors,
    value: place && {
      label: String(b.label || '').trim().slice(0, 30),
      districtCode: place.district.code,
      district: place.district.name,
      division: place.division.name,
      area,
      line
    }
  };
};

const fieldErrors = (res, errors) => res.status(400).json({ status: 'fail', message: Object.values(errors)[0], errors });
const sendAddresses = (res, user, { status = 200, message } = {}) => res.status(status).json({
  status: 'success',
  ...(message ? { message } : {}),
  data: { addresses: [...user.addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map(addressView) }
});

// GET /me/addresses/districts — "Select District" (all 64, A to Z)
exports.districts = (req, res) => res.status(200).json({ status: 'success', data: { districts: districtList() } });

// GET /me/addresses/areas?district=BD-C-dhaka — "Select Area" for the chosen district
exports.areas = (req, res, next) => {
  const place = areasFor(String(req.query.district || ''));
  if (!place) return next(new AppError('Choose a district from the list.', 400));
  res.status(200).json({ status: 'success', data: { district: { code: place.district.code, name: place.district.name }, areas: place.areas } });
};

exports.listAddresses = catchAsync(async (req, res) => sendAddresses(res, req.user));

// POST /me/addresses { district, area, address, label?, isDefault? }
exports.addAddress = catchAsync(async (req, res, next) => {
  const { errors, value } = readAddress(req.body);
  if (Object.keys(errors).length) return fieldErrors(res, errors);
  const user = await User.findById(req.user._id);
  if (user.addresses.length >= MAX_ADDRESSES) return next(new AppError(`You can save up to ${MAX_ADDRESSES} addresses. Delete one first.`, 400));
  const makeDefault = req.body.isDefault === true || req.body.isDefault === 'true' || !user.addresses.length;
  if (makeDefault) user.addresses.forEach(a => { a.isDefault = false; });
  user.addresses.push({ ...value, isDefault: makeDefault });
  syncDefault(user);
  await user.save({ validateBeforeSave: false });
  sendAddresses(res, user, { status: 201, message: 'Address saved.' });
});

const findAddress = (user, id, next) => {
  const a = mongoose.isValidObjectId(id) && user.addresses.id(id);
  if (!a) next(new AppError('No saved address with that ID.', 404));
  return a;
};

// PATCH /me/addresses/:id — same fields; isDefault: true makes it the default
exports.updateAddress = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  const a = findAddress(user, req.params.id, next);
  if (!a) return;
  const merged = { district: a.districtCode, area: a.area, address: a.line, label: a.label, ...req.body };
  // A new district needs its own area
  if (req.body.district && req.body.district !== a.districtCode && req.body.area === undefined) merged.area = '';
  const { errors, value } = readAddress(merged);
  if (Object.keys(errors).length) return fieldErrors(res, errors);
  Object.assign(a, value);
  if (req.body.isDefault === true || req.body.isDefault === 'true') {
    user.addresses.forEach(x => { x.isDefault = String(x._id) === String(a._id); });
  }
  syncDefault(user);
  await user.save({ validateBeforeSave: false });
  sendAddresses(res, user, { message: 'Address saved.' });
});

exports.deleteAddress = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  const a = findAddress(user, req.params.id, next);
  if (!a) return;
  a.deleteOne();
  if (!user.addresses.length) user.address = '';
  syncDefault(user);
  await user.save({ validateBeforeSave: false });
  sendAddresses(res, user, { message: 'Address deleted.' });
});

// ---------- My Interest ----------

const interestsView = user => {
  const chosen = new Set(user.interests || []);
  return {
    text: 'Select categories that interest you to receive personalized recommendations and deals',
    interests: INTERESTS.map(i => ({ ...i, selected: chosen.has(i.key) })),
    selected: INTERESTS.filter(i => chosen.has(i.key)).map(i => i.key)
  };
};

exports.getInterests = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: interestsView(req.user) });
});

// PUT /me/interests { interests: ['travel', 'hotel'] } — the whole selection (an empty list clears it)
exports.saveInterests = catchAsync(async (req, res, next) => {
  const raw = req.body.interests;
  if (!Array.isArray(raw)) return next(new AppError('Send interests as a list, for example ["travel", "hotel"].', 400));
  const keys = [...new Set(raw.map(String))];
  const unknown = keys.filter(k => !INTERESTS.some(i => i.key === k));
  if (unknown.length) return next(new AppError(`Unknown interest: ${unknown.join(', ')}. Choose from ${INTERESTS.map(i => i.key).join(', ')}.`, 400));
  const user = await User.findByIdAndUpdate(req.user._id, { interests: keys }, { new: true });
  res.status(200).json({ status: 'success', message: 'Interests saved.', data: interestsView(user) });
});

// ---------- Transaction History ----------

const PAYMENT_STATUS = { paid: 'Paid', partially_refunded: 'Partly refunded', refunded: 'Refunded' };
const WALLET_TITLES = { topup: 'Wallet top-up', refund: 'Refund', booking: 'Paid from wallet', promo: 'Promo credit', adjustment: 'Adjustment by Plejar' };

/**
 * GET /me/transactions?type=payment|wallet&page — booking payments and wallet changes, newest first.
 * amount is always positive; direction says whether money went out of or came into the account.
 */
exports.transactions = catchAsync(async (req, res) => {
  const type = ['payment', 'wallet'].includes(req.query.type) ? req.query.type : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const take = page * limit;
  const paidFilter = { user: req.user._id, paymentStatus: { $in: Object.keys(PAYMENT_STATUS) } };
  const [payments, wallet, paymentCount, walletCount, me] = await Promise.all([
    type === 'wallet' ? [] : Booking.find(paidFilter).sort({ paidAt: -1, updatedAt: -1 }).limit(take).select('reference packageTitle kind amount discountAmount voucherCode paymentStatus paidAt updatedAt').lean(),
    type === 'payment' ? [] : WalletTransaction.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(take).populate('booking', 'reference packageTitle').lean(),
    type === 'wallet' ? 0 : Booking.countDocuments(paidFilter),
    type === 'payment' ? 0 : WalletTransaction.countDocuments({ user: req.user._id }),
    User.findById(req.user._id).select('walletBalance').lean()
  ]);
  const rows = [
    ...payments.map(b => ({
      _id: b._id,
      type: 'payment',
      title: b.packageTitle,
      subtitle: `Booking ${b.reference}`,
      kind: b.kind,
      amount: b.amount,
      direction: 'out',
      status: b.paymentStatus,
      statusLabel: PAYMENT_STATUS[b.paymentStatus],
      discount: b.discountAmount ? { amount: b.discountAmount, voucherCode: b.voucherCode } : null,
      booking: { _id: b._id, reference: b.reference },
      at: b.paidAt || b.updatedAt
    })),
    ...wallet.map(t => ({
      _id: t._id,
      type: 'wallet',
      title: WALLET_TITLES[t.reason] || 'Wallet',
      subtitle: t.booking ? `${t.booking.packageTitle} (${t.booking.reference})` : t.note,
      amount: t.amount,
      direction: t.type === 'credit' ? 'in' : 'out',
      status: 'completed',
      statusLabel: t.type === 'credit' ? 'Received' : 'Spent',
      balanceAfter: t.balanceAfter,
      booking: t.booking ? { _id: t.booking._id, reference: t.booking.reference } : null,
      at: t.createdAt
    }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice((page - 1) * limit, take);
  const total = paymentCount + walletCount;
  res.status(200).json({
    status: 'success',
    results: rows.length,
    data: {
      walletBalance: (me && me.walletBalance) || 0,
      transactions: rows,
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1)
    }
  });
});

exports.INTERESTS = INTERESTS;
