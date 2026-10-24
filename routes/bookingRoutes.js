const express = require('express');
const authController = require('../controllers/authController');
const bookingController = require('../controllers/bookingController');

const router = express.Router();

router.use(authController.protect);

router.post('/', bookingController.createBooking);
router.get('/mine', bookingController.listMyBookings);
router.patch('/:id/cancel', bookingController.cancelMyBooking);

module.exports = router;
