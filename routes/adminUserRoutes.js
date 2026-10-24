const express = require('express');
const authController = require('../controllers/authController');
const adminUserController = require('../controllers/adminUserController');

const router = express.Router();

// Master admin area: administrators, managers and developers
router.use(authController.protect, authController.restrictTo('admin', 'manager', 'dev'));

router.get('/users/summary', adminUserController.summary);
router.get('/users', adminUserController.listUsers);

router
  .route('/users/:id')
  .get(adminUserController.getUser)
  .patch(adminUserController.updateUser)
  .delete(adminUserController.deleteUser);

router.post('/users/:id/status', adminUserController.setStatus);
router.post('/users/:id/restrictions', adminUserController.setRestrictions);
router.post('/users/:id/restore', adminUserController.restoreUser);
router.post('/users/:id/verify', adminUserController.verifyUser);
router.get('/users/:id/documents/:docId', adminUserController.getDocument);

router.get('/users/:id/bookings', adminUserController.userBookings);
router.get('/users/:id/reviews', adminUserController.userReviews);
router.get('/users/:id/complaints', adminUserController.userComplaints);
router.get('/users/:id/logins', adminUserController.userLogins);
router.get('/users/:id/activity', adminUserController.userActivity);

// Money and permanent removal are for administrators and developers only
router.get('/users/:id/wallet', adminUserController.getWallet);
router.post('/users/:id/wallet', authController.restrictTo('admin', 'dev'), adminUserController.adjustWallet);
router.delete('/users/:id/permanent', authController.restrictTo('admin', 'dev'), adminUserController.permanentlyDelete);

router.get('/complaints', adminUserController.listComplaints);
router.patch('/complaints/:id', adminUserController.updateComplaint);

router.get('/reviews', adminUserController.listReviews);
router.patch('/reviews/:id', adminUserController.moderateReview);

router.get('/logins', adminUserController.listLogins);
router.get('/activity', adminUserController.listActivity);

module.exports = router;
