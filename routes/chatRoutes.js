const express = require('express');
const { protect, restrictTo } = require('../controllers/authController');
const { requireAgent } = require('../controllers/agencyController');
const chat = require('../controllers/chatController');
const { chatUpload } = require('../utils/chatFiles');

// Chat: the same room routes for travelers, agencies and Plejar support, each on its own path

// Opening a chat, its messages, sending, reading, deleting your own message, attachments
const roomRoutes = router => {
  router.get('/', chat.list);
  router.get('/unread', chat.unread);
  router.get('/:id', chat.getRoom);
  router.get('/:id/participants', chat.participants);
  router.route('/:id/messages').get(chat.messages).post(chatUpload, chat.send);
  router.delete('/:id/messages/:messageId', chat.deleteMessage);
  router.post('/:id/read', chat.read);
  router.get('/:id/attachments/:attachmentId', chat.attachment);
  return router;
};

// Travelers in the app: /api/v1/chats
const traveler = express.Router();
traveler.use(protect, chat.useSide('traveler'));
traveler.post('/direct', chat.startDirect);
traveler.post('/support', chat.startSupport);
traveler.post('/guides/:guideId', chat.startGuide);
traveler.post('/agencies/:agencyId', chat.startAgency);
traveler.post('/tours/:tourId', chat.openTourGroup);
traveler.patch('/:id', chat.updateMine);
roomRoutes(traveler);

// The agency's team in the vendor panel: /api/v1/agency/me/chats (tour groups, guide and agency chats)
const agency = express.Router();
agency.use(protect, requireAgent, chat.useSide('agency'));
agency.post('/tours/:tourId', chat.agencyOpenTourGroup);
agency.patch('/:id', chat.setStatus);
roomRoutes(agency);

// Plejar staff answering Customer Support: /api/v1/admin/support-chats
const support = express.Router();
support.use(protect, restrictTo('admin', 'manager', 'dev'), chat.useSide('support'));
support.patch('/:id', chat.setStatus);
roomRoutes(support);

module.exports = { traveler, agency, support };
