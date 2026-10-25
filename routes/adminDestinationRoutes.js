const express = require('express');
const authController = require('../controllers/authController');
const d = require('../controllers/adminDestinationController');
const { imageUpload } = require('../utils/uploads');

const router = express.Router();

// Managers can edit destinations; deleting is for administrators and developers
const adminOnly = authController.restrictTo('admin', 'dev');

router.get('/destinations/summary', d.summary);
router.get('/destinations/options', d.options);
router.get('/destinations/geography', d.geography);
router.get('/destinations/statistics', d.statistics);
router.get('/destinations/trending', d.listTrending);
router.route('/destinations/featured').get(d.listFeatured).put(d.setFeatured);
router.route('/destinations').get(d.listDestinations).post(d.createDestination);
router.route('/destinations/:id').get(d.getDestination).patch(d.updateDestination).delete(adminOnly, d.deleteDestination);
router.route('/destinations/:id/photos').post(imageUpload.array('photos', 10), d.addPhotos).patch(d.updatePhotos);
router.delete('/destinations/:id/photos/:photoId', d.deletePhoto);

router.route('/destination-categories').get(d.listCategories).post(d.createCategory);
router.route('/destination-categories/:id').patch(d.updateCategory).delete(adminOnly, d.deleteCategory);

module.exports = router;
