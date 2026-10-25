const express = require('express');

const userController = require('../controllers/userController');
const authController = require('../controllers/authController');
const { userDocumentUpload } = require('../utils/uploads');
const { signupPhotoUpload } = require('../utils/userImages');

const router = express.Router();

router.post('/signup', signupPhotoUpload, authController.signup);
router.get('/check-email', authController.checkEmail);
router.post('/login', authController.login);
router.post('/google-login', authController.googleLogin);
router.post('/forgotPassword', authController.forgotPassword);
router.patch('/resetPassword/:token', authController.resetPassword);
router.get('/invite/:token', authController.checkInvite);
router.patch('/acceptInvite/:token', authController.acceptInvite);

router.get('/logout', authController.logout);

// Protecting below router with this line. Above routes won't be affected with this protection
router.use(authController.protect);

router.get('/me', authController.getMe);
router.get('/me/verification', userController.getMyVerification);
router.post(
    '/me/verification',
    userDocumentUpload.fields([
        { name: 'nid', maxCount: 1 },
        { name: 'passport', maxCount: 1 },
        { name: 'drivingLicense', maxCount: 1 },
        { name: 'selfie', maxCount: 1 }
    ]),
    userController.submitMyVerification);
router.patch('/changePassword', authController.changePassword);
router.patch(
    '/updateMe',
    userController.uploadUserPhoto,
    userController.resizeUserPhoto,
    userController.updateMe);
router.delete('/deleteMe', userController.deleteMe);

router.get('/profile',
    userController.getProfile,
    userController.getUser);

router.use(authController.restrictTo('admin', 'manager', 'dev'));

router
    .route('/')
    .get(userController.getAllUsers)
    .post(userController.createUser);

router
    .route('/:id/details')
    .get(userController.getUserDetails);

router.patch('/:id/reset-password', userController.adminResetUserPassword);
router.post('/:id/send-reset-link', userController.adminSendResetEmail);

router
    .route('/:id')
    .get(userController.getUser)
    .patch(userController.updateUser)
    .delete(userController.deleteUser);

module.exports = router;