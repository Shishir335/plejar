// The hotel panel (/hotel): a hotel that joined through /apply manages its own listing (details,
// photos, room types and rates, amenities and policies) and answers travelers' stay requests.
// Plejar publishes the listing the first time; after that the hotel's edits show in the app straight away.
const Hotel = require('../models/hotelModel');
const StayRequest = require('../models/stayRequestModel');
const Notification = require('../models/notificationModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { validId, pageParams, paged } = require('../utils/query');
const { saveContentImage, removeContentImage } = require('../utils/uploads');
const { applyHotelExtras, extrasView } = require('../utils/hotelExtras');

const MAX_PHOTOS = 12;
const MAX_ROOM_PHOTOS = 6;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const POLICY_KEYS = ['cancellation', 'children', 'pets', 'smoking', 'other'];

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
// A list from an array, or from text with one item per line or comma
const list = (v, max, len) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map(s => text(s, len)).filter(Boolean))].slice(0, max);
const whole = (value, label, { min = 0, max = 100000000, empty = undefined } = {}) => {
  const raw = String(value == null ? '' : value).replace(/[,\s৳]/g, '');
  if (raw === '') return empty;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`Enter ${label} as a whole number${min ? ` from ${min}` : ''}${max < 100000000 ? ` to ${max}` : ''}.`, 400);
  return n;
};
const has = (b, key) => Object.prototype.hasOwnProperty.call(b, key);

// ---------- Who may use it ----------

// The vendor panel's tour pages (events, guides, ads, announcements...) are for tour agencies only
exports.toursOnly = (req, res, next) => {
  if (req.agency && req.agency.kind === 'hotel') return next(new AppError('This is for tour agencies. Hotels use their panel at /hotel.', 403));
  next();
};

exports.hotelsOnly = (req, res, next) => {
  if (!req.agency || req.agency.kind !== 'hotel') return next(new AppError('This panel is for hotel accounts. Tour agencies sign in at /agent.', 403));
  next();
};

// The hotel this account manages (the one its application created)
exports.loadHotel = catchAsync(async (req, res, next) => {
  req.hotel = await Hotel.findOne({ agency: req.agency._id }).sort({ createdAt: 1 });
  if (!req.hotel) return next(new AppError("Plejar hasn't set up your hotel listing yet. It shows here once our team creates it.", 404));
  next();
});

// ---------- Views ----------

const roomView = r => ({
  _id: r._id,
  name: r.name,
  description: r.description,
  pricePerNight: r.pricePerNight,
  regularPrice: r.regularPrice,
  maxGuests: r.maxGuests,
  beds: r.beds,
  sizeSqft: r.sizeSqft,
  count: r.count,
  amenities: r.amenities,
  benefits: r.benefits || [],
  photos: r.photos,
  active: r.active !== false
});

const hotelView = h => ({
  _id: h._id,
  name: h.name,
  type: h.type,
  status: h.status,
  starRating: h.starRating,
  description: h.description,
  address: h.address,
  phone: h.phone,
  website: h.website,
  checkIn: h.checkIn,
  checkOut: h.checkOut,
  rooms: h.rooms,
  pricePerNight: h.pricePerNight,
  photos: h.photos,
  highlights: h.highlights,
  amenities: h.amenities,
  policies: h.policies || {},
  roomTypes: (h.roomTypes || []).map(roomView),
  ...extrasView(h),
  hasMapPosition: Boolean(h.location && h.location.coordinates && h.location.coordinates.length === 2),
  updatedAt: h.updatedAt
});
exports.roomView = roomView;

const requestView = r => ({
  _id: r._id,
  status: r.status,
  roomType: r.roomType,
  roomName: r.roomName,
  pricePerNight: r.pricePerNight,
  checkIn: r.checkIn,
  checkOut: r.checkOut,
  nights: r.nights,
  rooms: r.rooms,
  guests: r.guests,
  estimatedTotal: r.estimatedTotal,
  guestName: r.guestName || (r.user && r.user.name) || '',
  phone: r.phone || (r.user && r.user.phone) || '',
  email: r.user && r.user.email ? r.user.email : '',
  note: r.note,
  hotelNote: r.hotelNote,
  decidedAt: r.decidedAt,
  cancelledAt: r.cancelledAt,
  createdAt: r.createdAt
});

// The lowest active room price is the "from" price travelers see
const syncFromPrice = hotel => {
  const prices = (hotel.roomTypes || []).filter(r => r.active !== false).map(r => r.pricePerNight).filter(n => Number.isFinite(n));
  if (prices.length) hotel.pricePerNight = Math.min(...prices);
};

const todayUTC = () => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())}T00:00:00Z`);

// ---------- Panel ----------

exports.getPanel = catchAsync(async (req, res) => {
  const hotel = await Hotel.findOne({ agency: req.agency._id }).sort({ createdAt: 1 });
  const today = todayUTC();
  const [pending, upcoming] = hotel ? await Promise.all([
    StayRequest.countDocuments({ hotel: hotel._id, status: 'pending' }),
    StayRequest.countDocuments({ hotel: hotel._id, status: 'accepted', checkOut: { $gte: today } })
  ]) : [0, 0];
  const a = req.agency;
  res.status(200).json({
    status: 'success',
    data: {
      agency: {
        _id: a._id, name: a.name, logo: a.logo, phone: a.phone, email: a.email, website: a.website, address: a.address,
        description: a.description, tradeLicenseNumber: a.tradeLicenseNumber, verified: a.verified,
        verification: { status: (a.verification && a.verification.status) || 'none', note: (a.verification && a.verification.note) || '' }
      },
      me: { id: req.user._id, name: req.user.name, email: req.user.email, agencyRole: req.user.agencyRole, mustChangePassword: Boolean(req.user.mustChangePassword) },
      hotel: hotel ? hotelView(hotel) : null,
      counts: { pendingRequests: pending, upcomingStays: upcoming }
    }
  });
});

// Details, amenities and policies. The name, kind of stay, star rating and map position stay with Plejar.
exports.updateHotel = catchAsync(async (req, res) => {
  const hotel = req.hotel;
  const b = req.body || {};
  ['description', 'address', 'phone', 'website'].forEach(key => {
    const max = { description: 3000, address: 200, phone: 30, website: 200 }[key];
    if (has(b, key)) hotel[key] = text(b[key], max);
  });
  ['checkIn', 'checkOut'].forEach(key => {
    if (!has(b, key)) return;
    const v = text(b[key], 5);
    if (v && !TIME.test(v)) throw new AppError('Choose the check-in and check-out times from the clock.', 400);
    hotel[key] = v;
  });
  if (has(b, 'rooms')) hotel.rooms = whole(b.rooms, 'the number of rooms', { min: 1, max: 5000, empty: null });
  if (has(b, 'pricePerNight') && !(hotel.roomTypes || []).some(r => r.active !== false)) {
    hotel.pricePerNight = whole(b.pricePerNight, 'the price per night', { empty: hotel.pricePerNight });
  }
  if (has(b, 'amenities')) hotel.amenities = list(b.amenities, 40, 40);
  if (has(b, 'highlights')) hotel.highlights = list(b.highlights, 6, 60);
  if (b.policies && typeof b.policies === 'object') {
    POLICY_KEYS.forEach(key => {
      if (has(b.policies, key)) hotel.set(`policies.${key}`, text(b.policies[key], key === 'cancellation' || key === 'other' ? 1000 : 500));
    });
  }
  applyHotelExtras(hotel, b);
  await hotel.save();
  await logActivity(req, { action: 'hotel.updated', summary: `Updated the details of ${hotel.name} from the hotel panel`, agency: req.agency._id });
  res.status(200).json({ status: 'success', data: { hotel: hotelView(hotel) } });
});

// ---------- Photos ----------

exports.addPhotos = catchAsync(async (req, res) => {
  const hotel = req.hotel;
  const files = req.files || [];
  if (!files.length) throw new AppError('Choose at least one photo.', 400);
  const room = MAX_PHOTOS - hotel.photos.length;
  if (files.length > room) throw new AppError(room ? `A hotel can have up to ${MAX_PHOTOS} photos, so you can add ${room} more.` : `A hotel can have up to ${MAX_PHOTOS} photos. Remove one first.`, 400);
  const urls = await Promise.all(files.map(f => saveContentImage(f, 'hotels', hotel._id)));
  hotel.photos.push(...urls);
  await hotel.save();
  res.status(200).json({ status: 'success', data: { hotel: hotelView(hotel) } });
});

exports.removePhoto = catchAsync(async (req, res) => {
  const hotel = req.hotel;
  const url = text(req.body && req.body.url, 500);
  if (!hotel.photos.includes(url)) throw new AppError('That photo is not on your listing.', 404);
  hotel.photos = hotel.photos.filter(p => p !== url);
  await hotel.save();
  await removeContentImage(url).catch(() => {});
  res.status(200).json({ status: 'success', data: { hotel: hotelView(hotel) } });
});

// The first photo is the cover travelers see
exports.orderPhotos = catchAsync(async (req, res) => {
  const hotel = req.hotel;
  const order = [].concat((req.body && req.body.photos) || []).map(String);
  hotel.photos = [...order.filter(p => hotel.photos.includes(p)), ...hotel.photos.filter(p => !order.includes(p))];
  await hotel.save();
  res.status(200).json({ status: 'success', data: { hotel: hotelView(hotel) } });
});

// ---------- Room types ----------

const applyRoom = (room, b, { creating = false } = {}) => {
  if (creating || has(b, 'name')) {
    const name = text(b.name, 60);
    if (!name) throw new AppError('Name the room type, for example "Deluxe double".', 400);
    room.name = name;
  }
  if (creating || has(b, 'pricePerNight')) {
    const price = whole(b.pricePerNight, 'the price per night');
    if (price === undefined) throw new AppError('Enter the price per night in taka, for example 3500.', 400);
    room.pricePerNight = price;
  }
  if (has(b, 'regularPrice')) room.regularPrice = whole(b.regularPrice, 'the regular price', { empty: null });
  if (has(b, 'maxGuests')) room.maxGuests = whole(b.maxGuests, 'the number of guests', { min: 1, max: 20, empty: 2 });
  if (has(b, 'count')) room.count = whole(b.count, 'how many rooms of this type you have', { min: 1, max: 500, empty: 1 });
  if (has(b, 'sizeSqft')) room.sizeSqft = whole(b.sizeSqft, 'the room size', { max: 20000, empty: null });
  if (has(b, 'description')) room.description = text(b.description, 600);
  if (has(b, 'beds')) room.beds = text(b.beds, 60);
  if (has(b, 'amenities')) room.amenities = list(b.amenities, 20, 40);
  // Unknown benefits are dropped, not refused, so an older panel still saves
  if (has(b, 'benefits')) room.benefits = [...new Set(list(b.benefits, 20, 40))].filter(k => Hotel.ROOM_BENEFITS.includes(k));
  if (has(b, 'active')) room.active = !(b.active === false || b.active === 'false');
  if (room.regularPrice != null && room.regularPrice <= room.pricePerNight) room.regularPrice = null;
};

const findRoom = (hotel, id) => {
  const room = validId(id) ? hotel.roomTypes.id(id) : null;
  if (!room) throw new AppError('No room type found with that ID.', 404);
  return room;
};

exports.addRoom = catchAsync(async (req, res) => {
  const hotel = req.hotel;
  if (hotel.roomTypes.length >= 30) throw new AppError('A hotel can list up to 30 room types.', 400);
  const room = hotel.roomTypes.create({});
  applyRoom(room, req.body || {}, { creating: true });
  const files = req.files || [];
  if (files.length > MAX_ROOM_PHOTOS) throw new AppError(`A room type can have up to ${MAX_ROOM_PHOTOS} photos.`, 400);
  room.photos = await Promise.all(files.map(f => saveContentImage(f, 'hotels', hotel._id)));
  hotel.roomTypes.push(room);
  syncFromPrice(hotel);
  await hotel.save();
  await logActivity(req, { action: 'hotel.room_added', summary: `Added the room type "${room.name}" to ${hotel.name}`, agency: req.agency._id });
  res.status(201).json({ status: 'success', data: { hotel: hotelView(hotel) } });
});

exports.updateRoom = catchAsync(async (req, res) => {
  const hotel = req.hotel;
  const room = findRoom(hotel, req.params.roomId);
  const b = req.body || {};
  applyRoom(room, b);
  const remove = [].concat(b.removePhotos || []).flatMap(v => String(v).split(',')).map(s => s.trim()).filter(Boolean);
  const dropped = room.photos.filter(p => remove.includes(p));
  room.photos = room.photos.filter(p => !remove.includes(p));
  const files = req.files || [];
  if (room.photos.length + files.length > MAX_ROOM_PHOTOS) throw new AppError(`A room type can have up to ${MAX_ROOM_PHOTOS} photos.`, 400);
  if (files.length) room.photos.push(...await Promise.all(files.map(f => saveContentImage(f, 'hotels', hotel._id))));
  syncFromPrice(hotel);
  await hotel.save();
  await Promise.all(dropped.map(p => removeContentImage(p).catch(() => {})));
  res.status(200).json({ status: 'success', data: { hotel: hotelView(hotel) } });
});

// Past requests keep the room's name and price, so a room type can go even after guests asked for it
exports.removeRoom = catchAsync(async (req, res) => {
  const hotel = req.hotel;
  const room = findRoom(hotel, req.params.roomId);
  const photos = [...room.photos];
  const name = room.name;
  room.deleteOne();
  syncFromPrice(hotel);
  await hotel.save();
  await Promise.all(photos.map(p => removeContentImage(p).catch(() => {})));
  await logActivity(req, { action: 'hotel.room_removed', summary: `Removed the room type "${name}" from ${hotel.name}`, agency: req.agency._id });
  res.status(200).json({ status: 'success', data: { hotel: hotelView(hotel) } });
});

// ---------- Stay requests ----------

exports.listRequests = catchAsync(async (req, res) => {
  const q = req.query;
  const today = todayUTC();
  const filter = { hotel: req.hotel._id };
  let sort = { createdAt: -1 };
  if (q.status === 'pending') { filter.status = 'pending'; sort = { checkIn: 1 }; }
  else if (q.status === 'upcoming') { filter.status = 'accepted'; filter.checkOut = { $gte: today }; sort = { checkIn: 1 }; }
  else if (q.status === 'past') { filter.$or = [{ status: { $in: ['declined', 'cancelled'] } }, { status: 'accepted', checkOut: { $lt: today } }]; }
  const page = pageParams(q);
  const [rows, total, counts] = await Promise.all([
    StayRequest.find(filter).sort(sort).skip(page.skip).limit(page.limit).populate('user', 'name email phone').lean(),
    StayRequest.countDocuments(filter),
    Promise.all([
      StayRequest.countDocuments({ hotel: req.hotel._id, status: 'pending' }),
      StayRequest.countDocuments({ hotel: req.hotel._id, status: 'accepted', checkOut: { $gte: today } })
    ])
  ]);
  res.status(200).json({ status: 'success', data: { requests: rows.map(requestView), counts: { pending: counts[0], upcoming: counts[1] }, ...paged(total, page) } });
});

const fmtDay = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

exports.decideRequest = catchAsync(async (req, res) => {
  const b = req.body || {};
  const decision = b.decision === 'accept' ? 'accepted' : b.decision === 'decline' ? 'declined' : null;
  if (!decision) throw new AppError('Choose to accept or decline the request.', 400);
  const request = validId(req.params.id) ? await StayRequest.findOne({ _id: req.params.id, hotel: req.hotel._id }) : null;
  if (!request) throw new AppError('No stay request found with that ID.', 404);
  if (request.status !== 'pending') throw new AppError(request.status === 'cancelled' ? 'The guest cancelled this request.' : `This request was already ${request.status}.`, 400);
  const note = text(b.note, 1000);
  if (decision === 'declined' && !note) throw new AppError('Tell the guest why, for example "Fully booked on those dates".', 400);

  request.status = decision;
  request.hotelNote = note;
  request.decidedAt = new Date();
  request.decidedBy = req.user._id;
  await request.save();

  const hotel = req.hotel;
  const dates = `${fmtDay(request.checkIn)} to ${fmtDay(request.checkOut)}`;
  await Notification.create({
    user: request.user,
    agency: req.agency._id,
    hotel: hotel._id,
    stayRequest: request._id,
    kind: decision === 'accepted' ? 'stay_accepted' : 'stay_declined',
    title: decision === 'accepted' ? `${hotel.name} accepted your stay` : `${hotel.name} can't host you`,
    body: [`${request.roomName ? `${request.roomName}, ` : ''}${dates}.`, note].filter(Boolean).join(' ')
  }).catch(err => console.warn('[STAY] Could not notify the guest:', err.message));

  await logActivity(req, { action: `stay.${decision}`, summary: `${decision === 'accepted' ? 'Accepted' : 'Declined'} a stay request for ${dates} at ${hotel.name}`, agency: req.agency._id });
  await request.populate('user', 'name email phone');
  res.status(200).json({ status: 'success', data: { request: requestView(request) } });
});
