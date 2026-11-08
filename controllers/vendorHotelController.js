// Vendor panel for a hotel that joined through /apply: its own listing(s). Plejar staff add photos
// and publish; the hotel keeps its everyday details (price, rooms, times, contact) up to date.
const Hotel = require('../models/hotelModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { validId } = require('../utils/query');

const SHOWN = 'name type description photos address pricePerNight regularPrice starRating rooms checkIn checkOut phone website status updatedAt';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// The panel's tour pages (events, guides, ads, announcements...) are for tour agencies only
exports.toursOnly = (req, res, next) => {
  if (req.agency && req.agency.kind === 'hotel') return next(new AppError('This part of the vendor panel is for tour agencies. Hotels manage their listing under Your hotel.', 403));
  next();
};

exports.hotelsOnly = (req, res, next) => {
  if (!req.agency || req.agency.kind !== 'hotel') return next(new AppError('This is for hotel accounts only.', 403));
  next();
};

exports.listMyHotels = catchAsync(async (req, res) => {
  const hotels = await Hotel.find({ agency: req.agency._id }).select(SHOWN).sort({ createdAt: 1 }).lean();
  res.status(200).json({ status: 'success', data: { hotels } });
});

// Only the everyday details; the name, kind of stay, photos and publishing stay with Plejar
exports.updateMyHotel = catchAsync(async (req, res, next) => {
  const hotel = validId(req.params.id) ? await Hotel.findOne({ _id: req.params.id, agency: req.agency._id }) : null;
  if (!hotel) return next(new AppError('No hotel found with that ID.', 404));
  const b = req.body || {};
  const number = (key, label, { min = 0, max, allowEmpty = false } = {}) => {
    if (b[key] === undefined) return;
    const raw = String(b[key]).replace(/[,\s]/g, '');
    if (raw === '' && allowEmpty) { hotel[key] = null; return; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || (max && n > max)) throw new AppError(`Enter ${label} as a whole number.`, 400);
    hotel[key] = n;
  };
  number('pricePerNight', 'the price per night');
  number('rooms', 'the number of rooms', { min: 1, max: 5000, allowEmpty: true });
  ['checkIn', 'checkOut'].forEach(key => {
    if (b[key] === undefined) return;
    const v = String(b[key]).trim();
    if (v && !TIME.test(v)) throw new AppError('Choose the check-in and check-out times from the clock.', 400);
    hotel[key] = v;
  });
  ['description', 'address', 'phone', 'website'].forEach(key => {
    if (b[key] !== undefined) hotel[key] = String(b[key]).trim();
  });
  await hotel.save();
  await logActivity(req, { action: 'hotel.updated', summary: `Updated the details of ${hotel.name} from the vendor panel`, agency: req.agency._id });
  res.status(200).json({ status: 'success', data: { hotel: await Hotel.findById(hotel._id).select(SHOWN).lean() } });
});
