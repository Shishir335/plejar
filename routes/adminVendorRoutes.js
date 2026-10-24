const express = require('express');
const authController = require('../controllers/authController');
const vendor = require('../controllers/adminVendorController');
const finance = require('../controllers/adminFinanceController');
const { documentUpload } = require('../utils/uploads');

const router = express.Router();

// Money and legal changes are for administrators and developers only
const moneyAdmin = authController.restrictTo('admin', 'dev');

router.get('/vendors/summary', vendor.summary);
router.get('/vendors', vendor.listVendors);
router.get('/vendors/:id', vendor.getVendor);
router.post('/vendors/:id/status', vendor.setStatus);
// Passwords: administrators and developers only, like the rest of account security
router.put('/vendors/:id/members/:userId/password', moneyAdmin, vendor.setMemberPassword);
router.put('/vendors/:id/categories', vendor.setCategories);
router.put('/vendors/:id/commission', moneyAdmin, vendor.setCommission);
router.put('/vendors/:id/contract', moneyAdmin, documentUpload.single('document'), vendor.updateContract);
router.get('/vendors/:id/contract/document', vendor.getContractDocument);
router.get('/vendors/:id/performance', vendor.getPerformance);
router.get('/vendors/:id/ratings', vendor.getRatings);
router.get('/vendors/:id/earnings', vendor.getEarnings);
router.get('/vendors/:id/payouts', finance.vendorPayouts);
router.post('/vendors/:id/payouts', moneyAdmin, finance.createPayout);

router.get('/bookings', finance.listBookings);
router.patch('/bookings/:id', finance.updateBooking);

router.get('/payouts', finance.listPayouts);
router.patch('/payouts/:id', moneyAdmin, finance.decidePayout);

router.route('/vendor-categories').get(finance.listCategories).post(moneyAdmin, finance.createCategory);
router.route('/vendor-categories/:id').patch(moneyAdmin, finance.updateCategory).delete(moneyAdmin, finance.deleteCategory);

router.get('/settings/commission', finance.getCommissionSetting);
router.put('/settings/commission', moneyAdmin, finance.setCommissionSetting);

module.exports = router;
