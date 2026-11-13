const express = require('express');
const authController = require('../controllers/authController');
const coupons = require('../controllers/couponController');

// The app's booking screens: coupons that fit a tour, guide or hotel, and checking a code
const router = express.Router();
router.use(authController.protect);

router.get('/available', coupons.available);
router.post('/check', coupons.check);

module.exports = router;
