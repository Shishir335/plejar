const express = require('express');
const authController = require('../controllers/authController');
const agencyController = require('../controllers/agencyController');
const panel = require('../controllers/vendorHotelController');
const coupons = require('../controllers/couponController');
const { imageUpload } = require('../utils/uploads');

// The hotel panel (/hotel): signed-in members of an active hotel account, scoped to their own hotel.
// The account's profile, team and verification use the shared /api/v1/agency/me routes.
const router = express.Router();
router.use(authController.protect, agencyController.requireAgent, panel.hotelsOnly);

router.get('/me', panel.getPanel);

// The hotel's own coupons for its stays (the hotel pays their discounts; the owner manages them)
router.route('/coupons').get(coupons.listMine).post(agencyController.requireOwner, coupons.createMine);
router.route('/coupons/:id').patch(agencyController.requireOwner, coupons.updateMine).delete(agencyController.requireOwner, coupons.deleteMine);

router.use(panel.loadHotel);
router.patch('/hotel', panel.updateHotel);
router.route('/hotel/photos').post(imageUpload.array('photos', 6), panel.addPhotos).delete(panel.removePhoto);
router.put('/hotel/photos/order', panel.orderPhotos);
router.post('/hotel/rooms', imageUpload.array('photos', 6), panel.addRoom);
router.post('/hotel/rooms/:roomId/copy', panel.copyRoom);
router.route('/hotel/rooms/:roomId').patch(imageUpload.array('photos', 6), panel.updateRoom).delete(panel.removeRoom);

router.get('/requests', panel.listRequests);
router.patch('/requests/:id', panel.decideRequest);

module.exports = router;
