const mongoose = require('mongoose');
const StayRequest = require('../models/stayRequestModel');
const Notification = require('../models/notificationModel');
require('../models/hotelModel'); // for populate('hotel')

/**
 * Stay requests a hotel hasn't answered within 24 hours expire: the rooms they held go back on sale
 * (utils/stayAvailability.js already stops counting them), the hotel can no longer accept them,
 * and the guest is told so they can ask again or try another hotel.
 * Runs every 15 minutes with the report scheduler, and before a hotel's or guest's request list loads.
 */
const fmtDay = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const expireStayRequests = async (scope = {}, now = new Date()) => {
  if (mongoose.connection.readyState !== 1) return { expired: 0 };
  const due = await StayRequest.find({ ...scope, status: 'pending', createdAt: { $lte: new Date(now.getTime() - StayRequest.ANSWER_WITHIN) } })
    .populate('hotel', 'name').limit(500);
  let expired = 0;
  for (const request of due) {
    // Only the first to change it notifies, if two runs overlap or the hotel answers at the same moment
    const changed = await StayRequest.updateOne({ _id: request._id, status: 'pending' }, { $set: { status: 'expired', expiredAt: now } });
    if (!changed.modifiedCount) continue;
    expired += 1;
    const hotelName = (request.hotel && request.hotel.name) || 'The hotel';
    await Notification.create({
      user: request.user,
      agency: request.agency,
      hotel: request.hotel && request.hotel._id,
      stayRequest: request._id,
      kind: 'stay_expired',
      title: `${hotelName} didn't answer in time`,
      body: `Your request for ${request.roomName ? `${request.roomName}, ` : ''}${fmtDay(request.checkIn)} to ${fmtDay(request.checkOut)} wasn't answered within 24 hours, so it was closed. You can ask again or try another hotel.`
    }).catch(err => console.warn('[STAY] Could not tell the guest a request expired:', err.message));
  }
  return { expired };
};

module.exports = { expireStayRequests };
