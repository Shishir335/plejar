const express = require('express');
const authController = require('../controllers/authController');
const adminAgencyController = require('../controllers/adminAgencyController');
const adminDashboardController = require('../controllers/adminDashboardController');
const { imageUpload } = require('../utils/uploads');

const router = express.Router();

// Master admin only
router.use(authController.protect, authController.restrictTo('admin', 'manager', 'dev'));

router.get('/stats', adminAgencyController.getStats);
router.get('/dashboard', adminDashboardController.getDashboard);

router
  .route('/agencies')
  .get(adminAgencyController.listAgencies)
  .post(adminAgencyController.createAgency);

router
  .route('/agencies/:id')
  .get(adminAgencyController.getAgency)
  .patch(imageUpload.single('logo'), adminAgencyController.updateAgency);

router.post('/agencies/:id/verify', adminAgencyController.verifyAgency);
router.get('/agencies/:id/documents/:docId', adminAgencyController.getAgencyDocument);
router.patch('/agencies/:id/packages/:packageId', adminAgencyController.moderatePackage);
router.post('/agencies/:id/members/:userId/resend', adminAgencyController.resendInvite);

module.exports = router;
