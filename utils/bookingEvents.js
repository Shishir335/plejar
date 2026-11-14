const Notification = require('../models/notificationModel');
const User = require('../models/userModel');
const Booking = require('../models/bookingModel');
const bookingMoney = require('./bookingMoney');
const { awardBookingPoints } = require('./rewards');
const { releaseVoucher } = require('./vouchers');
const { releaseCoupon } = require('./coupons');
const { rewardReferrer } = require('./referrals');
const { joinTourGroup, leaveTourGroup } = require('./chats');

// What happens around a booking's status: the traveler's notification, points when a trip is completed
// (and the referral reward for whoever invited them), the voucher back when it's cancelled,
// and the traveler's place in the tour's group chat

const WHAT = { tour: 'tour', hotel: 'hotel stay', guide: 'guide booking' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = d => (d ? `${new Date(d).getUTCDate()} ${MONTHS[new Date(d).getUTCMonth()]}` : '');

const tell = async (booking, kind, title, body) => {
  try {
    const user = await User.findById(booking.user).select('settings status');
    if (!user || user.status !== 'active') return;
    if (user.settings && user.settings.notifications && user.settings.notifications.tours === false) return;
    await Notification.create({
      user: booking.user,
      kind,
      title: title.slice(0, 120),
      body: body.slice(0, 3000),
      agency: booking.agency || undefined,
      event: booking.package || undefined,
      booking: booking._id
    });
  } catch (err) {
    console.warn('[NOTIFY WARNING]', err.message);
  }
};

/** Right after a traveler books: "We sent your request" */
const bookingRequested = booking => tell(
  booking,
  'booking_requested',
  `Request sent: ${booking.packageTitle}`,
  `Your ${WHAT[booking.kind] || 'booking'} for ${dayText(booking.travelDate)} is waiting for confirmation. Reference ${booking.reference}.`
);

/**
 * Call after a booking's status changed (by the agency, Plejar or the traveler).
 * `by` is who changed it: 'agency', 'admin' or 'traveler'.
 */
const bookingStatusChanged = async (booking, previous, { by } = {}) => {
  if (booking.status === previous) return;
  const what = WHAT[booking.kind] || 'booking';
  if (booking.status === 'cancelled' && booking.voucher) await releaseVoucher(booking.voucher);
  // A cancelled booking gives its coupon use back to the traveler
  if (booking.status === 'cancelled' && booking.couponRedemption) await releaseCoupon({ booking: booking._id });
  // Booking money: the traveler gets it all back unless they cancel a booking the agency already
  // confirmed; then the tour's cancellation refund, if they cancel early enough
  if (booking.status === 'cancelled' && booking.depositStatus === 'paid') {
    if (by === 'traveler' && ['confirmed', 'completed'].includes(previous)) await bookingMoney.cancelledLate(Booking, booking, booking.travelDate, { by: booking.user });
    else await bookingMoney.refundDeposit(Booking, booking, { reason: by === 'traveler' ? 'Cancelled by the traveler before it was confirmed' : `Cancelled by ${by === 'admin' ? 'Plejar' : 'the agency'}` });
  }
  // Tour group chat: confirmed travelers join, cancelled ones leave
  try {
    if (booking.status === 'confirmed') await joinTourGroup(booking, await User.findById(booking.user).select('name firstName'));
    else if (booking.status === 'cancelled') await leaveTourGroup(booking);
  } catch (err) {
    console.warn('[CHAT WARNING]', err.message);
  }
  if (booking.status === 'confirmed') {
    await tell(booking, 'booking_confirmed', `Confirmed: ${booking.packageTitle}`, `Your ${what} on ${dayText(booking.travelDate)} is confirmed. Reference ${booking.reference}.`);
  } else if (booking.status === 'cancelled' && by !== 'traveler') {
    await tell(booking, 'booking_cancelled', `Cancelled: ${booking.packageTitle}`, `Your ${what} on ${dayText(booking.travelDate)} was cancelled${booking.cancelReason ? `: ${booking.cancelReason}` : '.'}`);
  } else if (booking.status === 'completed') {
    const points = await awardBookingPoints(booking);
    await tell(booking, 'booking_completed', `Hope you enjoyed ${booking.packageTitle}`,
      `${points ? `You earned ${points.toLocaleString('en-US')} points. ` : ''}Tell other travelers how it was: leave a review.`);
    await rewardReferrer(booking);
  }
};

/** The day before: departure time and meeting point, or the hotel's check-in time */
const tripReminder = (booking, details) => tell(booking, 'trip_reminder', `Tomorrow: ${booking.packageTitle}`, details);

module.exports = { bookingRequested, bookingStatusChanged, tripReminder };
