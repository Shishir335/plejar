const mongoose = require('mongoose');
const Package = require('../models/packageModel');
const Destination = require('../models/destinationModel');
const AppError = require('./appError');

// A vendor must declare the whole plan before a tour event can be published:
// price and payment, departure, transport, stay, a day-by-day itinerary with stops, and the policies.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_STOPS_PER_DAY = 30;

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
const list = (value, max = 30) => (Array.isArray(value) ? value : String(value || '').split('\n'))
  .map(s => text(s, 200)).filter(Boolean).slice(0, max);
const money = (value, label) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new AppError(`Enter the ${label} in taka, 0 or more.`, 400);
  return Math.round(n);
};

/**
 * Read the plan a vendor sent (a JSON string in multipart forms, or an object) and apply it to the event.
 * Only fields that were sent change. Throws AppError on bad input.
 */
const applyPlan = async (pkg, raw) => {
  if (raw === undefined || raw === null || raw === '') return;
  let plan = raw;
  if (typeof raw === 'string') {
    try {
      plan = JSON.parse(raw);
    } catch (err) {
      throw new AppError('The tour plan could not be read. Reload the page and try again.', 400);
    }
  }
  if (typeof plan !== 'object' || Array.isArray(plan)) throw new AppError('The tour plan could not be read.', 400);

  if (plan.departureTime !== undefined) {
    const t = text(plan.departureTime, 5);
    if (t && !TIME.test(t)) throw new AppError('Enter the departure time like 21:30.', 400);
    pkg.departureTime = t;
  }
  if (plan.returnInfo !== undefined) pkg.returnInfo = text(plan.returnInfo, 200);
  if (plan.transport !== undefined) {
    const mode = plan.transport && plan.transport.mode ? String(plan.transport.mode) : undefined;
    if (mode && !Package.TRANSPORT.includes(mode)) throw new AppError('Choose how travelers get there.', 400);
    pkg.transport = { mode, details: text(plan.transport && plan.transport.details, 300) };
  }
  if (plan.accommodation !== undefined) {
    const type = plan.accommodation && plan.accommodation.type ? String(plan.accommodation.type) : undefined;
    if (type && !Package.STAYS.includes(type)) throw new AppError('Choose where travelers stay.', 400);
    pkg.accommodation = { type, details: text(plan.accommodation && plan.accommodation.details, 300) };
  }
  if (plan.childPrice !== undefined) pkg.childPrice = money(plan.childPrice, 'child price');
  if (plan.advanceAmount !== undefined) pkg.advanceAmount = money(plan.advanceAmount, 'booking advance');
  if (plan.excluded !== undefined) pkg.excluded = list(plan.excluded);
  if (plan.whatToBring !== undefined) pkg.whatToBring = list(plan.whatToBring);
  if (plan.difficulty !== undefined) {
    const d = plan.difficulty ? String(plan.difficulty) : undefined;
    if (d && !['easy', 'moderate', 'challenging'].includes(d)) throw new AppError('Choose easy, moderate or challenging.', 400);
    pkg.difficulty = d;
  }
  if (plan.cancellationPolicy !== undefined) pkg.cancellationPolicy = text(plan.cancellationPolicy, 1500);

  if (plan.itinerary !== undefined) {
    if (!Array.isArray(plan.itinerary)) throw new AppError('The day-by-day plan could not be read.', 400);
    if (plan.itinerary.length > 60) throw new AppError('A plan can have at most 60 days.', 400);

    // Stops may link to published destinations, or to places vendors added that await review
    const ids = [...new Set(plan.itinerary.flatMap(d => (Array.isArray(d && d.stops) ? d.stops : []).map(s => s && s.destinationRef).filter(Boolean).map(String)))];
    const valid = new Set((await Destination.find({ _id: { $in: ids.filter(id => mongoose.isValidObjectId(id)) }, $or: [{ status: 'published' }, { source: 'vendor', status: 'draft' }] }).select('_id').lean()).map(d => String(d._id)));

    pkg.itinerary = plan.itinerary.map((d, i) => {
      const stops = (Array.isArray(d && d.stops) ? d.stops : [])
        .map(s => ({
          time: text(s && s.time, 5),
          place: text(s && s.place, 120),
          destinationRef: s && s.destinationRef && valid.has(String(s.destinationRef)) ? s.destinationRef : undefined,
          kind: Package.STOP_KINDS.includes(s && s.kind) ? s.kind : 'stop',
          note: text(s && s.note, 300)
        }))
        .filter(s => s.place || s.note || s.time);
      if (stops.length > MAX_STOPS_PER_DAY) throw new AppError(`Day ${i + 1} has more than ${MAX_STOPS_PER_DAY} stops.`, 400);
      const unnamed = stops.find(s => !s.place);
      if (unnamed) throw new AppError(`Day ${i + 1}: every stop needs a place name.`, 400);
      const badTime = stops.find(s => s.time && !TIME.test(s.time));
      if (badTime) throw new AppError(`Day ${i + 1}: enter times like 06:30 (at ${badTime.place}).`, 400);
      const meals = (d && d.meals) || {};
      return {
        day: i + 1,
        title: text(d && d.title, 120),
        stops,
        stay: text(d && d.stay, 120),
        meals: { breakfast: Boolean(meals.breakfast), lunch: Boolean(meals.lunch), dinner: Boolean(meals.dinner) }
      };
    });
  }
};

/**
 * What's still missing from an event's plan, in words the vendor understands.
 * An empty list means the plan is complete and the event can be published.
 */
const planProblems = pkg => {
  const missing = [];
  if (!pkg.destinationRef) missing.push('the destination (choose one from the list or add it)');
  const days = pkg.durationDays || 1;
  const nights = pkg.durationNights || 0;
  if (!pkg.startDate) missing.push('the start date');
  if (!pkg.seats) missing.push('the number of seats');
  if (pkg.priceFrom === undefined || pkg.priceFrom === null) missing.push('the price per person');
  if (pkg.advanceAmount === undefined || pkg.advanceAmount === null) missing.push('the booking advance (0 if none)');
  else if (pkg.priceFrom != null && pkg.advanceAmount > pkg.priceFrom) missing.push('a booking advance no higher than the price');
  if (!pkg.meetingPoint) missing.push('the meeting point');
  if (!pkg.departureTime) missing.push('the departure time');
  if (!pkg.returnInfo) missing.push('when and where the tour ends');
  if (!pkg.transport || !pkg.transport.mode) missing.push('how travelers get there (transport)');
  if (nights > 0 && (!pkg.accommodation || !pkg.accommodation.type || pkg.accommodation.type === 'none')) missing.push('where travelers stay');

  const itinerary = pkg.itinerary || [];
  if (itinerary.length !== days) {
    missing.push(`a plan for each of the ${days} day${days === 1 ? '' : 's'} (${itinerary.length} added)`);
  }
  itinerary.slice(0, days).forEach(d => {
    if (!d.stops || !d.stops.length) missing.push(`stops for day ${d.day}`);
    if (nights > 0 && d.day <= nights && !d.stay) missing.push(`where travelers sleep on night ${d.day}`);
  });
  const stopCount = itinerary.reduce((n, d) => n + ((d.stops && d.stops.length) || 0), 0);
  if (itinerary.length === days && stopCount > 0 && stopCount < 2) missing.push('at least 2 stops in the plan');

  if (!pkg.included || !pkg.included.length) missing.push("what's included in the price");
  if (!pkg.excluded || !pkg.excluded.length) missing.push("what's not included (costs travelers pay themselves)");
  if (!pkg.difficulty) missing.push('the difficulty level');
  if (!pkg.cancellationPolicy || pkg.cancellationPolicy.length < 20) missing.push('the cancellation and refund policy');
  return missing;
};

// "the meeting point, the departure time and 2 more"
const describeMissing = missing => (missing.length <= 4
  ? missing.join(', ').replace(/, ([^,]*)$/, ' and $1')
  : `${missing.slice(0, 3).join(', ')} and ${missing.length - 3} more`);

module.exports = { applyPlan, planProblems, describeMissing };
