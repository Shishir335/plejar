const express = require('express');
const authController = require('../controllers/authController');
const adminNotifications = require('../controllers/adminNotificationController');

const router = express.Router();

// Only admin, manager, and dev accounts can access notifications
router.use(authController.protect, authController.restrictTo('admin', 'manager', 'dev'));

router.get('/stats', adminNotifications.getStats);
router.get('/history', adminNotifications.getHistory);
router.post('/broadcast', adminNotifications.sendBroadcast);

module.exports = router;
