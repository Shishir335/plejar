const express = require('express');
const { buildCatalog } = require('../utils/routeCatalog');

const router = express.Router();

// Every endpoint the server answers, grouped by category (System Status in the admin panel)
router.get('/system/endpoints', (req, res) => {
  res.status(200).json({ status: 'success', data: buildCatalog(req.app) });
});

module.exports = router;
