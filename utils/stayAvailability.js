const StayRequest = require('../models/stayRequestModel');

/**
 * How many rooms of each type are free for a stay. A room type's quantity (`count`) is how many such rooms
 * the hotel has; accepted stays that overlap the dates hold their rooms. Pending requests don't hold
 * anything: the hotel decides, and accepting checks again.
 */

// The rooms in a request: its `items`, or the one room type older requests kept at the top level
const itemsOf = r => (r.items && r.items.length
  ? r.items
  : r.roomType ? [{ roomType: r.roomType, roomName: r.roomName, pricePerNight: r.pricePerNight, quantity: r.rooms || 1 }] : []);

// Rooms held by accepted stays overlapping [checkIn, checkOut), by room type id
const bookedRooms = async (hotelId, checkIn, checkOut, { exclude } = {}) => {
  const filter = { hotel: hotelId, status: 'accepted', checkIn: { $lt: checkOut }, checkOut: { $gt: checkIn } };
  if (exclude) filter._id = { $ne: exclude };
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
