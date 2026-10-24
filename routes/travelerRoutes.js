const express = require('express');
const authController = require('../controllers/authController');
const traveler = require('../controllers/travelerController');

// For the mobile app: public tour events and announcements, and the signed-in traveler's notifications
const events = express.Router();
events.get('/', traveler.listEvents);
events.get('/:id', traveler.getEvent);

const announcements = express.Router();
announcements.get('/', traveler.listAnnouncements);

const notifications = express.Router();
notifications.use(authController.protect);
notifications.get('/', traveler.myNotifications);
notifications.patch('/read-all', traveler.markAllRead);
notifications.patch('/:id/read', traveler.markRead);

module.exports = { events, announcements, notifications };
