const express = require('express');
const authController = require('../controllers/authController');
const { protect } = authController;
const appAuth = require('../controllers/appAuthController');
const account = require('../controllers/accountController');
const userController = require('../controllers/userController');
const { signupPhotoUpload } = require('../utils/userImages');

// Sign-up, sign-in and forgot password for the traveler app
const router = express.Router();

router.get('/google-client-id', authController.getGoogleClientId);
router.post('/register', signupPhotoUpload, appAuth.register);
router.get('/check', appAuth.checkAvailability);
router.get('/referral/:code', account.checkReferralCode);
router.post('/login', appAuth.login);
router.post('/google', appAuth.google);
router.post('/forgot-password', appAuth.forgotPassword);
router.post('/verify-code', appAuth.verifyCode);
router.post('/reset-password', appAuth.resetPassword);

router.get('/me', protect, appAuth.me);
router.post('/complete-profile', protect, signupPhotoUpload, appAuth.completeProfile);
router.post('/fcm-token', protect, userController.registerFcmToken);
router.delete('/fcm-token', protect, userController.removeFcmToken);
router.post('/logout', appAuth.logout);

module.exports = router;
