const StayRequest = require('../models/stayRequestModel');

/**
 * How many rooms of each type are free for a stay. A room type's quantity (`count`) is how many such rooms
 * the hotel has. A stay holds its rooms from the moment the guest asks: waiting (pending) and accepted
 * stays that overlap the dates both count, so two guests can't ask for the same last room. Declining,
 * cancelling, or the hotel not answering within 24 hours (StayRequest.ANSWER_WITHIN) frees them again.
 */

// The rooms in a request: its `items`, or the one room type older requests kept at the top level
const itemsOf = r => (r.items && r.items.length
  ? r.items
  : r.roomType ? [{ roomType: r.roomType, roomName: r.roomName, pricePerNight: r.pricePerNight, quantity: r.rooms || 1 }] : []);

// Rooms held by waiting and accepted stays overlapping [checkIn, checkOut), by room type id
// (exclude: leave one request out; upTo: only requests made up to and including that one)
const bookedRooms = async (hotelId, checkIn, checkOut, { exclude, upTo } = {}) => {
  // A waiting request stops holding its rooms after 24 hours, even before utils/stayExpiry.js marks it expired
  const answerBy = new Date(Date.now() - StayRequest.ANSWER_WITHIN);
  const filter = {
    hotel: hotelId,
    $or: [{ status: 'accepted' }, { status: 'pending', createdAt: { $gt: answerBy } }],
    checkIn: { $lt: checkOut },
    checkOut: { $gt: checkIn }
  };
  if (exclude) filter._id = { $ne: exclude };
  if (upTo) filter._id = { $lte: upTo };
  const rows = await StayRequest.find(filter).select('items roomType roomName pricePerNight rooms checkIn checkOut').lean();
  // Rooms are held night by night, so count the busiest night, not every overlapping stay together
  const nights = [];
  for (let t = checkIn.getTime(); t < checkOut.getTime(); t += 86400000) nights.push(t);
  const out = {};
  const perNight = {};
  rows.forEach(r => itemsOf(r).forEach(i => {
    const id = String(i.roomType);
    nights.forEach(t => {
      if (t >= new Date(r.checkIn).getTime() && t < new Date(r.checkOut).getTime()) {
        const key = `${id}|${t}`;
        perNight[key] = (perNight[key] || 0) + (i.quantity || 1);
        out[id] = Math.max(out[id] || 0, perNight[key]);
      }
    });
  }));
  return out;
};

// Every active room type with its quantity and what is free for those dates
const availability = async (hotel, checkIn, checkOut, options) => {
  const booked = await bookedRooms(hotel._id, checkIn, checkOut, options);
  return (hotel.roomTypes || []).filter(r => r.active !== false).map(r => {
    const count = r.count || 1;
    const held = booked[String(r._id)] || 0;
    return { _id: r._id, name: r.name, count, booked: held, available: Math.max(count - held, 0) };
  });
};

module.exports = { itemsOf, bookedRooms, availability };
