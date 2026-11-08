// Travelers asking a hotel for a stay (from the hotel page in the app), and following their requests.
// The hotel answers from its panel (/hotel); see vendorHotelController.
const Hotel = require('../models/hotelModel');
const User = require('../models/userModel');
const StayRequest = require('../models/stayRequestModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Email = require('../utils/email');
const { validId, pageParams, paged } = require('../utils/query');

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NIGHTS = 30;
const MAX_PENDING = 3;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const day = value => {
  const v = text(value, 10);
  if (!DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
};
const todayUTC = () => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())}T00:00:00Z`);
const BD_PHONE = /^(?:\+?88)?01[3-9]\d{8}$/;

const myView = r => ({
  _id: r._id,
  status: r.status,
  hotel: r.hotel && r.hotel._id ? { _id: r.hotel._id, name: r.hotel.name, photo: (r.hotel.photos || [])[0] || '', address: r.hotel.address, phone: r.hotel.phone } : r.hotel,
  roomType: r.roomType,
  roomName: r.roomName,
  pricePerNight: r.pricePerNight,
  checkIn: r.checkIn,
  checkOut: r.checkOut,
  nights: r.nights,
  rooms: r.rooms,
  guests: r.guests,
  estimatedTotal: r.estimatedTotal,
  note: r.note,
  hotelNote: r.hotelNote,
  decidedAt: r.decidedAt,
  cancelledAt: r.cancelledAt,
  createdAt: r.createdAt,
  canCancel: r.status === 'pending' || (r.status === 'accepted' && new Date(r.checkIn) > todayUTC())
});

// POST /api/v1/hotels/:id/stay-requests { roomType, checkIn, checkOut, rooms, guests, note, phone }
exports.create = catchAsync(async (req, res, next) => {
  const hotel = validId(req.params.id) ? await Hotel.findOne({ _id: req.params.id, status: 'published' }) : null;
  if (!hotel) return next(new AppError('This hotel is not available.', 404));
  if (!hotel.agency) return next(new AppError('This hotel takes bookings by phone. Call them to ask for a room.', 400));
  const b = req.body || {};

  const room = validId(b.roomType) ? hotel.roomTypes.id(b.roomType) : null;
  if (!room || room.active === false) return next(new AppError('Choose a room type.', 400));
  const checkIn = day(b.checkIn);
  const checkOut = day(b.checkOut);
  if (!checkIn || !checkOut) return next(new AppError('Choose your check-in and check-out dates.', 400));
  if (checkIn < todayUTC()) return next(new AppError('Check-in can be today at the earliest.', 400));
  const nights = Math.round((checkOut - checkIn) / 86400000);
  if (nights < 1) return next(new AppError('Check-out must be at least one night after check-in.', 400));
  if (nights > MAX_NIGHTS) return next(new AppError(`You can ask for up to ${MAX_NIGHTS} nights at a time.`, 400));
  const rooms = Number(b.rooms || 1);
  const guests = Number(b.guests || 1);
  if (!Number.isInteger(rooms) || rooms < 1 || rooms > Math.min(room.count || 1, 20)) return next(new AppError(`This room type has ${room.count || 1} room${(room.count || 1) === 1 ? '' : 's'}. Choose fewer rooms.`, 400));
  if (!Number.isInteger(guests) || guests < 1 || guests > room.maxGuests * rooms) return next(new AppError(`${room.name} fits ${room.maxGuests} guest${room.maxGuests === 1 ? '' : 's'} a room. Add a room or choose fewer guests.`, 400));
  const phone = text(b.phone || req.user.phone, 20).replace(/[\s-]/g, '');
  if (!BD_PHONE.test(phone)) return next(new AppError('Enter a mobile number the hotel can call, for example 01712345678.', 400));

  const pending = await StayRequest.countDocuments({ user: req.user._id, hotel: hotel._id, status: 'pending' });
  if (pending >= MAX_PENDING) return next(new AppError('You already have requests waiting for this hotel. Wait for their answer, or cancel one first.', 429));

  const request = await StayRequest.create({
    hotel: hotel._id,
    agency: hotel.agency,
    user: req.user._id,
    roomType: room._id,
    roomName: room.name,
    pricePerNight: room.pricePerNight,
    checkIn,
    checkOut,
    nights,
    rooms,
    guests,
    estimatedTotal: room.pricePerNight * nights * rooms,
    guestName: text(req.user.name, 80),
    phone,
    note: text(b.note, 1000)
  });

  // Tell the hotel's team by email; a slow or blocked mail server never holds up the guest
  User.find({ agency: hotel.agency, deletedAt: null }).select('name email').lean().then(team => Promise.all(team.filter(u => u.email).map(u =>
    new Email(u, `${req.protocol}://${req.get('host')}/hotel#requests`, {
      hotelName: hotel.name, guestName: request.guestName, roomName: room.name, nights, rooms, guests,
      dates: `${checkIn.toISOString().slice(0, 10)} to ${checkOut.toISOString().slice(0, 10)}`
    }).sendStayRequest().catch(err => console.warn(`[MAIL WARNING] Stay request email to ${u.email} not sent:`, err.message))
  ))).catch(() => {});

  await request.populate('hotel', 'name photos address phone');
  res.status(201).json({
    status: 'success',
    message: `Request sent to ${hotel.name}. They will accept or decline it, and we will let you know.`,
    data: { request: myView(request) }
  });
});

// GET /api/v1/hotels/stay-requests (the traveler's own)
exports.mine = catchAsync(async (req, res) => {
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
  request.status = 'cancelled';
  request.cancelledAt = new Date();
  await request.save();
  res.status(200).json({ status: 'success', data: { request: myView(request) } });
});
