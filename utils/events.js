const Booking = require('../models/bookingModel');
const AppError = require('./appError');

// Registrations that hold a seat
const HOLDS_SEAT = ['pending', 'confirmed'];
const DAY = 24 * 60 * 60 * 1000;

const dayStart = d => new Date(d).setUTCHours(0, 0, 0, 0);
const dayOf = d => new Date(d).toISOString().slice(0, 10);

const toDate = value => {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/**
 * Read an event's schedule from a request body, falling back to what the event already has.
 * Works out the number of days and nights from the dates. Throws AppError on bad input.
 */
const scheduleFrom = (body, existing = {}) => {
  const read = (field, label) => {
    if (body[field] === undefined) return existing[field] || null;
    const d = toDate(body[field]);
    if (d === undefined) throw new AppError(`Enter a valid ${label}.`, 400);
    return d;
  };
  const startDate = read('startDate', 'start date');
  const endDate = read('endDate', 'end date') || startDate;
  let registrationDeadline = read('registrationDeadline', 'registration closing date');

  if (!startDate) throw new AppError('Choose the date the tour starts.', 400);
  if (endDate < startDate) throw new AppError('The tour cannot end before it starts.', 400);

  // A closing date without a time means "until the end of that day in Bangladesh", but never after the tour starts
  if (registrationDeadline && body.registrationDeadline !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(body.registrationDeadline))) {
    if (dayOf(registrationDeadline) > dayOf(startDate)) {
      throw new AppError('Registration must close on or before the start date.', 400);
    }
    const endOfDay = new Date(`${body.registrationDeadline}T23:59:59+06:00`);
    registrationDeadline = endOfDay < startDate ? endOfDay : startDate;
  } else if (registrationDeadline && registrationDeadline > startDate) {
    throw new AppError('Registration must close on or before the start date.', 400);
  }

  const durationDays = Math.round((dayStart(endDate) - dayStart(startDate)) / DAY) + 1;
  if (durationDays > 60) throw new AppError('A tour event can last at most 60 days.', 400);
  const nights = body.durationNights !== undefined && body.durationNights !== '' ? Number(body.durationNights) : durationDays - 1;

  return { startDate, endDate, registrationDeadline, durationDays, durationNights: Math.max(0, Math.min(nights, 60)) };
};

// Per-event registration numbers: { [eventId]: { registrations, travelers, seatsTaken, pending, confirmed, completed, cancelled } }
const registrationStats = async eventIds => {
  const rows = await Booking.aggregate([
    { $match: { package: { $in: eventIds } } },
    { $group: { _id: { event: '$package', status: '$status' }, count: { $sum: 1 }, travelers: { $sum: '$travelers' } } }
  ]);
  const stats = {};
  rows.forEach(({ _id, count, travelers }) => {
    const key = String(_id.event);
    stats[key] = stats[key] || { registrations: 0, travelers: 0, seatsTaken: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
    const s = stats[key];
    s[_id.status] = count;
    if (_id.status !== 'cancelled') {
      s.registrations += count;
      s.travelers += travelers;
    }
    if (HOLDS_SEAT.includes(_id.status)) s.seatsTaken += travelers;
  });
  return stats;
};

const EMPTY_STATS = { registrations: 0, travelers: 0, seatsTaken: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0 };

// An event with its registration numbers and seats left (for the vendor panel and the app)
const withStats = (event, stats) => {
  const s = (stats && stats[String(event._id)]) || EMPTY_STATS;
  const plain = typeof event.toObject === 'function' ? event.toObject() : event;
  return { ...plain, stats: s, seatsLeft: event.seats ? Math.max(event.seats - s.seatsTaken, 0) : null };
};

// Is registration open right now? Returns null when open, or the reason it isn't.
const registrationClosedReason = (event, now = new Date()) => {
  if (event.status !== 'published') return 'This tour event is not open for registration.';
  if (!event.startDate) return null;
  if (event.startDate <= now) return 'This tour event has already started.';
  if (event.registrationDeadline && event.registrationDeadline < now) return 'Registration for this tour event has closed.';
  return null;
};

module.exports = { HOLDS_SEAT, scheduleFrom, registrationStats, withStats, registrationClosedReason };
