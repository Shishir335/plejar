const express = require('express');
const { protect, optionalAuth } = require('../controllers/authController');
const tours = require('../controllers/toursController');
const hotels = require('../controllers/hotelController');
const promotions = require('../controllers/promotionController');
const chat = require('../controllers/chatController');
const guides = require('../controllers/guideController');
const stays = require('../controllers/stayController');

// The app's Tours tab (anyone can browse; hearts, searches and recently viewed need sign-in)
const tourRouter = express.Router();
tourRouter.get('/home', optionalAuth, tours.home);
tourRouter.get('/types', tours.types);
tourRouter.get('/tags', tours.tags);
tourRouter.get('/filters', tours.filters);
tourRouter.route('/searches').get(protect, tours.listSearches).delete(protect, tours.clearSearches);
tourRouter.delete('/searches/:id', protect, tours.deleteSearch);
tourRouter.route('/recently-viewed').get(protect, tours.listRecentlyViewed).post(protect, tours.addRecentlyViewed).delete(protect, tours.clearRecentlyViewed);
tourRouter.get('/', optionalAuth, tours.listTours);
tourRouter.get('/:id', optionalAuth, tours.getTour);
tourRouter.get('/:id/reviews', tours.tourReviews);
tourRouter.post('/:id/messages', protect, chat.askAboutTour);
tourRouter.route('/:id/save').post(protect, tours.save('tour')).delete(protect, tours.unsave('tour'));

// "Hotels Near You" and the hotel pages
const hotelRouter = express.Router();
hotelRouter.get('/nearby', optionalAuth, hotels.nearby);
hotelRouter.get('/', optionalAuth, hotels.listHotels);
hotelRouter.get('/:id/reviews', hotels.hotelReviews);
// A traveler's stay requests to hotels, and asking for a stay
hotelRouter.get('/stay-requests', protect, stays.mine);
hotelRouter.post('/stay-requests/:id/cancel', protect, stays.cancel);
hotelRouter.get('/:id', optionalAuth, hotels.getHotel);
hotelRouter.get('/:id/availability', stays.availability);
hotelRouter.post('/:id/stay-requests', protect, stays.create);
hotelRouter.route('/:id/save').post(protect, tours.save('hotel')).delete(protect, tours.unsave('hotel'));

// Banners at the top of the Tours screen
const promotionRouter = express.Router();
promotionRouter.get('/', promotions.listLive);

// Local guides travelers can hire ("Guide" in My Bookings)
const guideRouter = express.Router();
guideRouter.get('/', guides.listBookable);
guideRouter.get('/:id', guides.getBookable);

module.exports = { tours: tourRouter, hotels: hotelRouter, promotions: promotionRouter, guides: guideRouter };
