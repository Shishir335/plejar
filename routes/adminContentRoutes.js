const express = require('express');
const authController = require('../controllers/authController');
const hotels = require('../controllers/hotelController');
const promotions = require('../controllers/promotionController');
const { imageUpload } = require('../utils/uploads');

// App content the master admin manages: hotels and Tours-screen banners
const router = express.Router();
const adminOnly = authController.restrictTo('admin', 'dev');

router.route('/hotels').get(hotels.adminList).post(imageUpload.array('photos', 6), hotels.adminCreate);
router.route('/hotels/:id').get(hotels.adminGet).patch(imageUpload.array('photos', 6), hotels.adminUpdate).delete(adminOnly, hotels.adminDelete);

router.route('/promotions').get(promotions.adminList).post(imageUpload.single('image'), promotions.adminCreate);
router.route('/promotions/:id').patch(imageUpload.single('image'), promotions.adminUpdate).delete(adminOnly, promotions.adminDelete);

module.exports = router;
