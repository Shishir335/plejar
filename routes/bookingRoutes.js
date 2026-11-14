const express = require('express');
const authController = require('../controllers/authController');
const bookingController = require('../controllers/bookingController');
const { requireVerifiedIdentity } = require('../utils/identity');

const router = express.Router();

router.use(authController.protect);

// Only travelers whose ID and face photos an admin approved can book
router.post('/', requireVerifiedIdentity, bookingController.createBooking);
router.get('/mine', bookingController.listMyBookings);
router.patch('/:id/cancel', bookingController.cancelMyBooking);

module.exports = router;
