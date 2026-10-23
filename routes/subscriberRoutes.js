const express = require('express');
const subscriberController = require('../controllers/subscriberController');
const authController = require('../controllers/authController');

const router = express.Router();

// Public: Subscribe to drop alerts / newsletter
router.post('/', subscriberController.subscribe);

// Admin-protected: List, export, and delete subscribers
router.use(authController.protect, authController.restrictTo('admin', 'manager', 'dev'));

router.get('/', subscriberController.getAllSubscribers);
router.get('/export', subscriberController.exportSubscribersCSV);
router.delete('/:id', subscriberController.deleteSubscriber);

module.exports = router;
