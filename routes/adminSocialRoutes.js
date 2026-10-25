const express = require('express');
const adminSocialController = require('../controllers/adminSocialController');

const router = express.Router();

// Posts, comments and reports from the traveler app
router.get('/posts/summary', adminSocialController.summary);
router.get('/posts', adminSocialController.listPosts);
router.route('/posts/:id').get(adminSocialController.getPost).patch(adminSocialController.moderatePost);
router.patch('/comments/:id', adminSocialController.moderateComment);

router.get('/social-reports', adminSocialController.listReports);
router.patch('/social-reports/:id', adminSocialController.resolveReport);

module.exports = router;
