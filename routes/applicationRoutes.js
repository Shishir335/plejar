const express = require('express');
const applicationController = require('../controllers/applicationController');
const { applicationUpload } = require('../utils/uploads');

const router = express.Router();

// Public: tour agencies apply for membership from the website and follow their application
router.get('/categories', applicationController.listCategories);
router.post('/', applicationUpload, applicationController.createApplication);
router.post('/status', applicationController.checkStatus);
router.post('/reply', applicationUpload, applicationController.reply);

module.exports = router;
