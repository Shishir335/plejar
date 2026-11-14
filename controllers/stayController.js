// Travelers asking a hotel for a stay (from the hotel page in the app), and following their requests.
// The hotel answers from its panel (/hotel); see vendorHotelController.
const Hotel = require('../models/hotelModel');
const User = require('../models/userModel');
const StayRequest = require('../models/stayRequestModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Email = require('../utils/email');
const { validId, pageParams, paged } = require('../utils/query');
const membership = require('../utils/vendorMembership');
const { itemsOf, availability } = require('../utils/stayAvailability');
const { expireStayRequests } = require('../utils/stayExpiry');
const { claimCoupon, releaseCoupon } = require('../utils/coupons');
const { CouponRedemption } = require('../models/couponModel');
const Agency = require('../models/agencyModel');
const { termsFor, snapshot } = require('../utils/commission');
const { cancelRefundOf } = require('../utils/cancelRefund');
const { clientOf } = require('../utils/client');
const bookingMoney = require('../utils/bookingMoney');

// What a stay request may carry, kept on a booking-money payment until the money arrives
const draftOf = b => ({
  ...(Array.isArray(b.items) && b.items.length ? { items: b.items.slice(0, 10).map(i => ({ roomType: String((i && i.roomType) || '').slice(0, 30), quantity: Number(i && i.quantity) || 1 })) } : {}),
  ...Object.fromEntries(['roomType', 'rooms', 'checkIn', 'checkOut', 'guests', 'note', 'phone', 'couponCode']
    .filter(k => b[k] !== undefined && b[k] !== null && b[k] !== '')
    .map(k => [k, typeof b[k] === 'number' ? b[k] : String(b[k]).slice(0, k === 'note' ? 1000 : 40)]))
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NIGHTS = 30;
const MAX_PENDING = 3;
const MAX_ROOM_TYPES = 10;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const day = value => {
  const v = text(value, 10);
  if (!DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
};
const todayUTC = () => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())}T00:00:00Z`);
const BD_PHONE = /^(?:\+?88)?01[3-9]\d{8}$/;

// Each room type in a request with its quantity and what it costs for the stay
const itemsView = r => itemsOf(r).map(i => ({
  roomType: i.roomType,
  roomName: i.roomName,
  pricePerNight: i.pricePerNight,
  quantity: i.quantity || 1,
  total: (i.pricePerNight || 0) * (i.quantity || 1) * (r.nights || 1)
}));
exports.itemsView = itemsView;

// "2 × Deluxe, 1 × Normal" (just "Deluxe" for one room of one type)
const roomsSummary = items => (items.length === 1 && items[0].quantity === 1
  ? items[0].roomName
  : items.map(i => `${i.quantity} × ${i.roomName}`).join(', '));
exports.roomsSummary = roomsSummary;

const myView = r => ({
  _id: r._id,
  status: r.status,
  hotel: r.hotel && r.hotel._id ? { _id: r.hotel._id, name: r.hotel.name, photo: (r.hotel.photos || [])[0] || '', address: r.hotel.address, phone: r.hotel.phone } : r.hotel,
  items: itemsView(r),
  roomType: r.roomType,
  roomName: r.roomName,
  pricePerNight: r.pricePerNight,
  nightlyTotal: r.nightlyTotal || (r.pricePerNight || 0) * (r.rooms || 1),
  checkIn: r.checkIn,
  checkOut: r.checkOut,
  nights: r.nights,
  rooms: r.rooms,
  guests: r.guests,
  estimatedTotal: r.estimatedTotal,
  // A coupon the guest used; estimatedTotal is already after it
  coupon: r.discountAmount ? { code: r.couponCode, discount: r.discountAmount, subtotal: r.subtotal } : null,
  // Booking money paid online: { amount, status } (refunded if cancelled before the hotel accepts)
  bookingMoney: bookingMoney.depositView(r, 'stay'),
  note: r.note,
  hotelNote: r.hotelNote,
  decidedAt: r.decidedAt,
  cancelledAt: r.cancelledAt,
  expiredAt: r.expiredAt,
  createdAt: r.createdAt,
  // While waiting: the hotel has until this time to answer, or the request expires
  answerBy: r.status === 'pending' ? StayRequest.expiresAt(r) : null,
  canCancel: r.status === 'pending' || (r.status === 'accepted' && new Date(r.checkIn) > todayUTC())
});

// GET /api/v1/hotels/:id/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD
// Each active room type with how many rooms it has (count) and how many are free for those dates (available)
exports.availability = catchAsync(async (req, res, next) => {
  const hotel = validId(req.params.id) ? await Hotel.findOne({ _id: req.params.id, status: 'published' }).select('roomTypes') : null;
  if (!hotel) return next(new AppError('This hotel is not available.', 404));
  const dates = stayDates(req.query);
  if (dates.error) return next(new AppError(dates.error, 400));
  res.status(200).json({ status: 'success', data: { checkIn: req.query.checkIn, checkOut: req.query.checkOut, nights: dates.nights, rooms: await availability(hotel, dates.checkIn, dates.checkOut) } });
});

const stayDates = b => {
  const checkIn = day(b.checkIn);
  const checkOut = day(b.checkOut);
  if (!checkIn || !checkOut) return { error: 'Choose your check-in and check-out dates.' };
  if (checkIn < todayUTC()) return { error: 'Check-in can be today at the earliest.' };
  const nights = Math.round((checkOut - checkIn) / 86400000);
  if (nights < 1) return { error: 'Check-out must be at least one night after check-in.' };
  if (nights > MAX_NIGHTS) return { error: `You can ask for up to ${MAX_NIGHTS} nights at a time.` };
  return { checkIn, checkOut, nights };
};

// POST /api/v1/hotels/:id/stay-requests
//   { items: [{ roomType, quantity }], checkIn, checkOut, guests, note, phone }
//   (older app versions send { roomType, rooms } for a single room type, which still works)
const prepareStay = async ctx => {
  const { user, hotelId } = ctx;
  const hotel = validId(hotelId) ? await Hotel.findOne({ _id: hotelId, status: 'published' }) : null;
  if (!hotel) throw new AppError('This hotel is not available.', 404);
  if (!hotel.agency) throw new AppError('This hotel takes bookings by phone. Call them to ask for a room.', 400);
  const b = ctx.body || {};

  // The rooms asked for, with the same room type added up if it appears twice
  const asked = Array.isArray(b.items) ? b.items : [{ roomType: b.roomType, quantity: b.rooms || 1 }];
  const wanted = new Map();
  for (const line of asked) {
    const room = line && validId(line.roomType) ? hotel.roomTypes.id(line.roomType) : null;
    if (!room || room.active === false) throw new AppError(asked.length > 1 ? 'One of those room types is no longer available. Choose again.' : 'Choose a room type.', 400);
    const quantity = Number(line.quantity == null ? 1 : line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) throw new AppError(`Choose how many ${room.name} rooms you need.`, 400);
    const id = String(room._id);
    wanted.set(id, { room, quantity: ((wanted.get(id) || {}).quantity || 0) + quantity });
  }
  if (!wanted.size) throw new AppError('Choose a room type.', 400);
  if (wanted.size > MAX_ROOM_TYPES) throw new AppError(`You can ask for up to ${MAX_ROOM_TYPES} room types at a time.`, 400);

  const dates = stayDates(b);
  if (dates.error) throw new AppError(dates.error, 400);
  const { checkIn, checkOut, nights } = dates;

  // Only rooms not held by other guests' waiting or accepted stays on those dates can be asked for
  const free = Object.fromEntries((await availability(hotel, checkIn, checkOut)).map(a => [String(a._id), a]));
  for (const [id, { room, quantity }] of wanted) {
    const left = free[id] ? free[id].available : 0;
    if (quantity > left) {
      throw new AppError(left
        ? `Only ${left} ${room.name} room${left === 1 ? ' is' : 's are'} free for those dates. Choose fewer.`
        : `${room.name} is fully booked for those dates. Choose other dates or another room type.`, 400);
    }
  }

  const items = [...wanted.values()].map(({ room, quantity }) => ({ roomType: room._id, roomName: room.name, pricePerNight: room.pricePerNight, quantity }));
  const rooms = items.reduce((n, i) => n + i.quantity, 0);
  const fits = [...wanted.values()].reduce((n, { room, quantity }) => n + (room.maxGuests || 1) * quantity, 0);
  const guests = Number(b.guests || 1);
  if (!Number.isInteger(guests) || guests < 1) throw new AppError('Enter how many guests are staying.', 400);
  if (guests > fits) throw new AppError(`Those rooms fit ${fits} guest${fits === 1 ? '' : 's'}. Add a room or choose fewer guests.`, 400);
  const phone = text(b.phone || user.phone, 20).replace(/[\s-]/g, '');
  if (!BD_PHONE.test(phone)) throw new AppError('Enter a mobile number the hotel can call, for example 01712345678.', 400);

  await expireStayRequests({ user: user._id, hotel: hotel._id });
  const pending = await StayRequest.countDocuments({ user: user._id, hotel: hotel._id, status: 'pending' });
  if (pending >= MAX_PENDING) throw new AppError('You already have requests waiting for this hotel. Wait for their answer, or cancel one first.', 429);

  const nightlyTotal = items.reduce((n, i) => n + i.pricePerNight * i.quantity, 0);
  const summary = roomsSummary(items);
  // A coupon from Plejar or from this hotel takes money off what the guest pays the hotel
  const subtotal = nightlyTotal * nights;
  const coupon = String(b.couponCode || '').trim()
    ? await claimCoupon(b.couponCode, { user: user._id, kind: 'hotel', vendor: hotel.agency, subtotal })
    : null;
  const couponFields = coupon ? {
    subtotal,
    discountAmount: coupon.discount,
    couponCode: coupon.coupon.code,
    couponRedemption: coupon.redemption._id,
    couponFundedBy: coupon.coupon.fundedBy
  } : {};
  // Plejar's commission, when it's on for this hotel. On a Plejar coupon Plejar pays the discount, so the
  // commission is on the full price; on the hotel's own coupon it's on what the guest pays.
  const estimatedTotal = subtotal - (coupon ? coupon.discount : 0);
  const vendor = await Agency.findById(hotel.agency).select('commission').lean();
  const commission = snapshot(coupon && coupon.coupon.fundedBy === 'plejar' ? subtotal : estimatedTotal, termsFor(vendor));
  // Booking money: what the hotel set per room, never more than the stay costs after its coupon
  const depositPer = hotel.bookingMoney >= 1 ? Math.round(hotel.bookingMoney) : 0;
  const deposit = Math.max(0, Math.min(depositPer * rooms, Math.floor(estimatedTotal)));
  return { hotel, items, rooms, guests, phone, nights, checkIn, checkOut, nightlyTotal, summary, wanted, coupon, couponFields, commission, estimatedTotal, depositPer, deposit, note: text(b.note, 1000) };
};

const releaseStayClaims = async ({ coupon }) => {
  if (coupon) await releaseCoupon({ _id: coupon.redemption._id });
};

/** Send the stay request a prepared one describes; `payment` is the booking money it was paid with */
const placeStay = async (ctx, prepared, payment = null) => {
  const { user } = ctx;
  const { hotel, items, rooms, guests, phone, nights, checkIn, checkOut, nightlyTotal, summary, wanted, coupon, couponFields, commission, estimatedTotal } = prepared;
  let request;
  try {
    request = await StayRequest.create({
      hotel: hotel._id,
      agency: hotel.agency,
      user: user._id,
      // The app or the website: from this request, or (paid by gateway callback) from when payment started
      source: ctx.req ? clientOf(ctx.req) : (payment && payment.source) || undefined,
      items,
      roomType: items[0].roomType,
      roomName: summary.length > 120 ? `${summary.slice(0, 119)}…` : summary,
      pricePerNight: items[0].pricePerNight,
      nightlyTotal,
      checkIn,
      checkOut,
      nights,
      rooms,
      guests,
      estimatedTotal,
      ...couponFields,
      ...commission,
      guestName: text(user.name, 80),
      phone,
      note: prepared.note,
      ...(payment ? { depositAmount: payment.amount, depositPayment: payment._id, depositStatus: 'paid', cancelRefund: cancelRefundOf(prepared.hotel) } : {})
    });
  } catch (err) {
    if (coupon) await releaseCoupon({ _id: coupon.redemption._id });
    throw err;
  }
  if (coupon) await CouponRedemption.updateOne({ _id: coupon.redemption._id }, { stayRequest: request._id });

  // Two guests may have asked for the last room at the same moment: check again now this request holds
  // its rooms, counting only requests made before it (and itself), so the first one keeps the room
  const after = await availability(hotel, checkIn, checkOut, { upTo: request._id });
  const over = after.find(a => wanted.has(String(a._id)) && a.booked > a.count);
  if (over) {
    await StayRequest.deleteOne({ _id: request._id });
    if (coupon) await releaseCoupon({ _id: coupon.redemption._id });
    throw new AppError(`${over.name} was just booked by someone else for those dates. Check what's free and try again.`, 409);
  }

  // Tell the hotel's team by email; a slow or blocked mail server never holds up the guest
  User.find({ ...membership.memberOf(hotel.agency), deletedAt: null }).select('name email').lean().then(team => Promise.all(team.filter(u => u.email).map(u =>
    new Email(u, `${ctx.base}/hotel#requests`, {
      hotelName: hotel.name, guestName: request.guestName, roomName: summary, nights, rooms, guests,
      dates: `${checkIn.toISOString().slice(0, 10)} to ${checkOut.toISOString().slice(0, 10)}`
    }).sendStayRequest().catch(err => console.warn(`[MAIL WARNING] Stay request email to ${u.email} not sent:`, err.message))
  ))).catch(() => {});

  await request.populate('hotel', 'name photos address phone');
  return request;
};

const sentMessage = hotel => `Request sent to ${hotel.name}. They will accept or decline it, and we will let you know.`;

/*
 * A hotel with booking money: send payWith ("bkash" or "sslcommerz") too. Nothing is sent to the hotel
 * yet; the answer (202) has the payment and a redirectUrl to pay at. Once the gateway confirms the money
 * the request goes to the hotel (GET /payments/:id shows it), or the money is refunded if the rooms went.
 */
exports.create = catchAsync(async (req, res) => {
  const ctx = { req, user: req.user, hotelId: req.params.id, body: req.body || {}, base: `${req.protocol}://${req.get('host')}` };
  const prepared = await prepareStay(ctx);
  if (prepared.deposit > 0) {
    await releaseStayClaims(prepared);
    const started = await bookingMoney.start(req, {
      purpose: 'stay',
      method: ctx.body.payWith,
      agency: prepared.hotel.agency,
      amount: prepared.deposit,
      perUnit: prepared.depositPer,
      units: prepared.rooms,
      description: `Booking money: ${prepared.hotel.name}`,
      draft: { hotelId: String(prepared.hotel._id), base: ctx.base, ...draftOf(ctx.body) }
    });
    return res.status(202).json({ status: 'success', message: 'Pay the booking money to send your request to the hotel.', data: started });
  }
  const request = await placeStay(ctx, prepared);
  res.status(201).json({ status: 'success', message: sentMessage(prepared.hotel), data: { request: myView(request) } });
});

/** Send a paid-for stay request from its payment's draft (utils/bookingMoney.js). Throws AppError when it can't. */
exports.placePaidStay = async (user, payment) => {
  const draft = payment.draft || {};
  const ctx = { user, hotelId: draft.hotelId, body: draft, base: draft.base || '' };
  const prepared = await prepareStay(ctx);
  if (prepared.deposit !== payment.amount || String(prepared.hotel.agency) !== String(payment.agency)) {
    await releaseStayClaims(prepared);
    throw new AppError('The hotel changed its booking money while you were paying. It is being refunded; please ask again.', 409);
  }
  return placeStay(ctx, prepared, payment);
};

// GET /api/v1/hotels/stay-requests (the traveler's own)
exports.mine = catchAsync(async (req, res) => {
  await expireStayRequests({ user: req.user._id });
  const page = pageParams(req.query);
  const filter = { user: req.user._id };
  if (StayRequest.STATUSES.includes(req.query.status)) filter.status = req.query.status;
  const [rows, total] = await Promise.all([
    StayRequest.find(filter).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit).populate('hotel', 'name photos address phone').lean(),
    StayRequest.countDocuments(filter)
  ]);
  res.status(200).json({ status: 'success', data: { requests: rows.map(myView), ...paged(total, page) } });
});

// POST /api/v1/hotels/stay-requests/:id/cancel
exports.cancel = catchAsync(async (req, res, next) => {
  const request = validId(req.params.id) ? await StayRequest.findOne({ _id: req.params.id, user: req.user._id }).populate('hotel', 'name photos address phone') : null;
  if (!request) return next(new AppError('No stay request found with that ID.', 404));
  if (!myView(request).canCancel) return next(new AppError('This request can no longer be cancelled here. Call the hotel.', 400));
  const previous = request.status;
  request.status = 'cancelled';
  request.cancelledAt = new Date();
  await request.save();
  if (request.couponRedemption) await releaseCoupon({ stayRequest: request._id });
  // Booking money comes back while the hotel hasn't answered; once it accepted, the hotel's
  // cancellation refund if early enough, and the hotel keeps the rest
  if (previous === 'pending') await bookingMoney.refundDeposit(StayRequest, request, { reason: 'Cancelled by the guest before the hotel answered', by: req.user._id });
  else await bookingMoney.cancelledLate(StayRequest, request, request.checkIn, { by: req.user._id });
  res.status(200).json({ status: 'success', data: { request: myView(request) } });
});
