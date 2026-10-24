const express = require('express');
const agentLeadController = require('../controllers/agentLeadController');
const authController = require('../controllers/authController');

const router = express.Router();

// Public: Tour agents send their details from the website
router.post('/', agentLeadController.createLead);

// Admin-protected: Review and manage agent leads
router.use(authController.protect, authController.restrictTo('admin', 'manager', 'dev'));

router.get('/', agentLeadController.getAllLeads);
router.patch('/:id', agentLeadController.updateLeadStatus);
router.delete('/:id', agentLeadController.deleteLead);

module.exports = router;
