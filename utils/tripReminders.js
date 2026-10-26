const mongoose = require('mongoose');
const Booking = require('../models/bookingModel');
const Package = require('../models/packageModel');
const Hotel = require('../models/hotelModel');
const { tripReminder } = require('./bookingEvents');

// The day before a confirmed trip, from 9:00 Bangladesh time: departure details, or the hotel's check-in time

const SEND_FROM_HOUR = 9;
const dhakaParts = now => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(now).map(x => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) };
};

const details = async booking => {
  if (booking.kind === 'tour') {
    const tour = await Package.findById(booking.package).select('departureTime meetingPoint').lean();
    const when = tour && tour.departureTime ? ` at ${tour.departureTime}` : '';
    const where = tour && tour.meetingPoint ? ` from ${tour.meetingPoint}` : '';
    return `Your tour leaves tomorrow${when}${where}. Reference ${booking.reference}. Have a great trip!`;
  }
  if (booking.kind === 'hotel') {
    const hotel = await Hotel.findById(booking.hotel).select('checkIn address').lean();
    const time = hotel && hotel.checkIn ? `from ${hotel.checkIn}` : 'tomorrow';
    return `Your room is ready for check-in ${time}${hotel && hotel.address ? ` at ${hotel.address}` : ''}. Reference ${booking.reference}.`;
  }
  return `Your guide meets you tomorrow. Message the agency if you need to change the plan. Reference ${booking.reference}.`;
};

const sendTripReminders = async (now = new Date()) => {
  if (mongoose.connection.readyState !== 1) return { skipped: 'database not connected' };
  const { y, m, d, h } = dhakaParts(now);
  if (h < SEND_FROM_HOUR) return { skipped: 'before 9:00 in Dhaka' };
  // Trip dates are calendar days at 00:00 UTC; tomorrow in Bangladesh
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
  const due = await Booking.find({ status: 'confirmed', travelDate: tomorrow, remindedAt: null }).limit(500);
  let sent = 0;
  await due.reduce((chain, booking) => chain.then(async () => {
    await tripReminder(booking, await details(booking));
    await Booking.updateOne({ _id: booking._id }, { remindedAt: now });
    sent += 1;
  }), Promise.resolve());
  return { sent };
};

module.exports = { sendTripReminders };
