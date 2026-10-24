const express = require('express');
const authController = require('../controllers/authController');
const application = require('../controllers/adminApplicationController');

const router = express.Router();

router.get('/applications/summary', application.summary);
router.get('/applications', application.listApplications);
router
  .route('/applications/:id')
  .get(application.getApplication)
  .patch(application.updateApplication)
  .delete(authController.restrictTo('admin', 'dev'), application.deleteApplication);
router.post('/applications/:id/approve', application.approve);
router.post('/applications/:id/credentials', application.resetCredentials);
router.post('/applications/:id/reject', application.reject);
router.post('/applications/:id/request-info', application.requestInfo);
router.get('/applications/:id/documents/:docId', application.getDocument);

module.exports = router;
