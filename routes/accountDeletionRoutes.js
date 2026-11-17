const express = require('express');
const accountDeletion = require('../controllers/accountDeletionController');

// plejar.com/delete-account: close an account with a code, without the app
const router = express.Router();

router.post('/code', accountDeletion.sendCode);
router.post('/confirm', accountDeletion.confirm);

module.exports = router;
