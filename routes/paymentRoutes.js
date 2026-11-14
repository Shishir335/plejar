const express = require('express');
const payments = require('../controllers/paymentController');
const authController = require('../controllers/authController');

// Where the payment gateways send vendors back (and SSLCommerz its IPN). No sign-in: each payment is
// checked with the gateway itself before anything changes.
const router = express.Router();

router.get('/bkash/callback', payments.bkashCallback);
router.post('/sslcommerz/success', payments.sslSuccess);
router.post('/sslcommerz/fail', payments.sslFail);
router.post('/sslcommerz/cancel', payments.sslCancel);
router.post('/sslcommerz/ipn', payments.sslIpn);
router.get('/done', payments.done);

// A traveler's own booking-money payment (the app checks it after the payment browser closes)
router.get('/:id', authController.protect, payments.myPayment);

module.exports = router;
