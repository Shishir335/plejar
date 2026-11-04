const express = require('express');
const authController = require('../controllers/authController');
const hotels = require('../controllers/hotelController');
const promotions = require('../controllers/promotionController');
const ads = require('../controllers/adController');
const vouchers = require('../controllers/voucherController');
const help = require('../controllers/helpController');
const pages = require('../controllers/pageController');
const { imageUpload } = require('../utils/uploads');

// App content the master admin manages: hotels, Tours-screen banners, vouchers, the Help Center and the About, Privacy and Terms pages
const router = express.Router();
const adminOnly = authController.restrictTo('admin', 'dev');

router.route('/hotels').get(hotels.adminList).post(imageUpload.array('photos', 6), hotels.adminCreate);
router.route('/hotels/:id').get(hotels.adminGet).patch(imageUpload.array('photos', 6), hotels.adminUpdate).delete(adminOnly, hotels.adminDelete);

router.route('/promotions').get(promotions.adminList).post(imageUpload.single('image'), promotions.adminCreate);
router.route('/promotions/:id').patch(imageUpload.single('image'), promotions.adminUpdate).delete(adminOnly, promotions.adminDelete);

// Vendors' ad applications
router.get('/ad-requests', ads.adminAdRequests);
router.post('/ad-requests/:id/approve', ads.adminApprove);
router.post('/ad-requests/:id/reject', ads.adminReject);

router.route('/vouchers').get(vouchers.adminList).post(imageUpload.single('image'), vouchers.adminCreate);
router.route('/vouchers/:id').patch(imageUpload.single('image'), vouchers.adminUpdate).delete(adminOnly, vouchers.adminDelete);
router.route('/rewards-settings').get(help.adminRewardSettings).patch(adminOnly, help.adminRewardSettings);

router.route('/help/articles').get(help.adminList).post(help.adminCreate);
router.route('/help/articles/:id').patch(help.adminUpdate).delete(adminOnly, help.adminDelete);
router.patch('/help/contact', help.adminUpdateContact);

router.get('/pages', pages.adminList);
router.patch('/pages/:key', adminOnly, pages.adminUpdate);

module.exports = router;
