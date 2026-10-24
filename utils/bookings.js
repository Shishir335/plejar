const AppError = require('./appError');

// Which status a booking can move to from each status
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

/**
 * Move a booking to a new status, setting the matching timestamp.
 * Throws a friendly error when the move isn't allowed.
 */
const moveBooking = (booking, status, { reason = '' } = {}) => {
  if (!(status in TRANSITIONS)) throw new AppError('Status must be pending, confirmed, completed or cancelled.', 400);
  if (booking.status === status) return booking;
  if (!TRANSITIONS[booking.status].includes(status)) {
    throw new AppError(`A ${booking.status} booking can't be marked ${status}.`, 400);
  }
  if (status === 'completed' && booking.travelDate > new Date()) {
    throw new AppError('A trip can only be marked completed on or after its travel date.', 400);
  }
  if (status === 'cancelled' && String(reason).trim().length < 3) {
    throw new AppError('Add a reason for cancelling this booking.', 400);
  }

  booking.status = status;
  const now = new Date();
  if (status === 'confirmed') booking.confirmedAt = now;
  if (status === 'completed') booking.completedAt = now;
  if (status === 'cancelled') {
    booking.cancelledAt = now;
    booking.cancelReason = String(reason).trim().slice(0, 500);
  }
  return booking;
};

module.exports = { TRANSITIONS, moveBooking };
