const express = require('express');
const authController = require('../controllers/authController');
const complaintController = require('../controllers/complaintController');

const router = express.Router();

router.use(authController.protect);

router.post('/', complaintController.createComplaint);
router.get('/mine', complaintController.listMyComplaints);

module.exports = router;
