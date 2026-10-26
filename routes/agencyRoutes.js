const express = require('express');
const authController = require('../controllers/authController');
const agencyController = require('../controllers/agencyController');
const content = require('../controllers/vendorContentController');
const places = require('../controllers/vendorDestinationController');
const guides = require('../controllers/guideController');
const messages = require('../controllers/messageController');
const { imageUpload, documentUpload } = require('../utils/uploads');

const router = express.Router();

// Agent panel: signed-in agents of an active agency, scoped to their own agency
router.use(authController.protect, agencyController.requireAgent);

router.get('/me', agencyController.getMyAgency);

// Tour guides shown on the app's tour page
router.route('/me/guides').get(guides.listGuides).post(imageUpload.single('photo'), guides.createGuide);
router.route('/me/guides/:id').patch(imageUpload.single('photo'), guides.updateGuide).delete(guides.deleteGuide);

// Travelers' questions ("Message Tour Guide" in the app)
router.get('/me/conversations', messages.agencyConversations);
router.route('/me/conversations/:id').get(messages.agencyConversationDetail).patch(messages.setConversationStatus);
router.post('/me/conversations/:id/messages', messages.replyAsAgency);
router.patch('/me', agencyController.requireOwner, imageUpload.single('logo'), agencyController.updateMyAgency);

router
  .route('/me/packages')
  .get(agencyController.listMyPackages)
  .post(imageUpload.array('photos', 6), agencyController.createMyPackage);
router
  .route('/me/packages/:id')
  .patch(imageUpload.array('photos', 6), agencyController.updateMyPackage)
  .delete(agencyController.deleteMyPackage);
router.post('/me/packages/:id/cancel', agencyController.cancelMyPackage);
// The shared destination list: pick a place, or add one that's missing
router.route('/me/destinations').get(places.listOptions).post(imageUpload.single('photo'), places.addDestination);
router.get('/me/destination-geography', places.geography);
router.get('/me/packages/:id/registrations', agencyController.listEventRegistrations);

router.route('/me/announcements').get(content.listAnnouncements).post(content.createAnnouncement);
router.route('/me/announcements/:id').patch(content.updateAnnouncement).delete(content.deleteAnnouncement);

router.get('/me/audience', content.getAudience);
router.route('/me/broadcasts').get(content.listBroadcasts).post(content.sendBroadcast);

router.get('/me/bookings', agencyController.listMyBookings);
router.patch('/me/bookings/:id', agencyController.updateMyBooking);

router.get('/me/earnings', agencyController.requireOwner, agencyController.getMyEarnings);
router
  .route('/me/payouts')
  .get(agencyController.requireOwner, agencyController.listMyPayouts)
  .post(agencyController.requireOwner, agencyController.requestPayout);

router.get('/me/team', agencyController.listTeam);
router.post('/me/team', agencyController.requireOwner, agencyController.inviteStaff);
router.post('/me/team/:userId/resend', agencyController.requireOwner, agencyController.resendStaffInvite);
router.delete('/me/team/:userId', agencyController.requireOwner, agencyController.removeStaff);

router.get('/me/verification', agencyController.requireOwner, agencyController.getVerification);
router.post(
  '/me/verification',
  agencyController.requireOwner,
  documentUpload.fields([{ name: 'tradeLicense', maxCount: 1 }, { name: 'nid', maxCount: 1 }]),
  agencyController.submitVerification
);
router.get('/me/documents/:docId', agencyController.requireOwner, agencyController.getMyDocument);

module.exports = router;
