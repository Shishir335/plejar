const express = require('express');
const authController = require('../controllers/authController');
const posts = require('../controllers/postController');
const people = require('../controllers/peopleController');
const agencies = require('../controllers/agencyDirectoryController');
const me = require('../controllers/meController');
const appConfig = require('../controllers/appConfigController');
const tours = require('../controllers/toursController');
const account = require('../controllers/accountController');
const { postMediaUpload } = require('../utils/social');
const { profileUpload } = require('../utils/userImages');
const users = require('../controllers/userController');
const vouchers = require('../controllers/voucherController');
const help = require('../controllers/helpController');
const pages = require('../controllers/pageController');
const profile = require('../controllers/profileController');
const agencyApplication = require('../controllers/agencyApplicationController');
const applications = require('../controllers/applicationController');
const { userDocumentUpload, applicationUpload, agencyApplicationUpload } = require('../utils/uploads');

// The traveler side of the mobile app

const { protect, optionalAuth } = authController;

// App start-up and the Live tab (coming soon)
const app = express.Router();
app.get('/config', appConfig.config);
app.get('/live', appConfig.live);
app.post('/live', protect, appConfig.startLive);

// Home tab
const feed = express.Router();
feed.get('/', protect, posts.feed);
feed.get('/tagged', optionalAuth, posts.taggedPosts);

const postRoutes = express.Router();
postRoutes.use(protect);
postRoutes.post('/', postMediaUpload, posts.createPost);
postRoutes.route('/:id').get(posts.getPost).patch(postMediaUpload, posts.updatePost).delete(posts.deletePost);
postRoutes.route('/:id/reactions').get(posts.postReactions).post(posts.reactToPost).delete(posts.unreactToPost);
postRoutes.post('/:id/share', posts.sharePost);
postRoutes.route('/:id/comments').get(posts.postComments).post(posts.addComment);
postRoutes.route('/:id/save').post(posts.savePost).delete(posts.unsavePost);
postRoutes.post('/:id/report', posts.reportPost);

const comments = express.Router();
comments.use(protect);
comments.route('/:id').patch(posts.updateComment).delete(posts.deleteComment);
comments.get('/:id/replies', posts.commentReplies);
comments.route('/:id/reactions').get(posts.commentReactions).post(posts.reactToComment).delete(posts.unreactToComment);
comments.post('/:id/report', posts.reportComment);

// Other travelers' profiles
const peopleRoutes = express.Router();
peopleRoutes.use(protect);
peopleRoutes.get('/search', people.search);
peopleRoutes.get('/:id', people.profile);
peopleRoutes.get('/:id/posts', people.posts);
peopleRoutes.get('/:id/followers', people.followers);
peopleRoutes.get('/:id/following', people.following);
peopleRoutes.route('/:id/follow').post(people.follow).delete(people.unfollow);
peopleRoutes.route('/:id/block').post(people.block).delete(people.unblock);
peopleRoutes.post('/:id/report', people.report);

// Agents tab (anyone can browse; following needs sign-in)
const agencyRoutes = express.Router();
agencyRoutes.get('/', optionalAuth, agencies.listAgencies);
agencyRoutes.get('/filters', agencies.filters);
agencyRoutes.get('/:id', optionalAuth, agencies.getAgency);
agencyRoutes.get('/:id/posts', optionalAuth, agencies.wallPosts);
agencyRoutes.get('/:id/media', agencies.wallMedia);
agencyRoutes.route('/:id/follow').post(protect, agencies.follow).delete(protect, agencies.unfollow);

// Settings tab
const meRoutes = express.Router();
meRoutes.use(protect);
meRoutes.route('/profile').get(me.getProfile).patch(profileUpload, me.updateProfile);
meRoutes.route('/settings').get(me.getSettings).patch(me.updateSettings);
meRoutes.get('/saved', me.savedPosts);
meRoutes.get('/blocked', me.blocked);
meRoutes.get('/following-agencies', me.followingAgencies);
meRoutes.get('/wishlist', tours.wishlist);
meRoutes.get('/travel-history', account.travelHistory);
meRoutes.get('/rewards', account.rewards);
meRoutes.get('/points', account.pointsHistory);
meRoutes.patch('/password', account.changePassword);
// The Account screen and its pages
meRoutes.get('/account', profile.account);
meRoutes.get('/addresses/districts', profile.districts);
meRoutes.get('/addresses/areas', profile.areas);
meRoutes.route('/addresses').get(profile.listAddresses).post(profile.addAddress);
meRoutes.route('/addresses/:id').patch(profile.updateAddress).delete(profile.deleteAddress);
meRoutes.route('/interests').get(profile.getInterests).put(profile.saveInterests);
meRoutes.get('/transactions', profile.transactions);
meRoutes.get('/referrals', account.referrals);
// ID Verification: email and phone codes, then the ID document and a selfie (multipart: nid | passport | drivingLicense, selfie)
meRoutes.get('/verification', account.verification);
meRoutes.post('/verification/:channel(email|phone)/send', account.sendContactCode);
meRoutes.post('/verification/:channel(email|phone)/confirm', account.confirmContactCode);
meRoutes.post(
  '/verification/documents',
  userDocumentUpload.fields([{ name: 'nid', maxCount: 1 }, { name: 'passport', maxCount: 1 }, { name: 'drivingLicense', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]),
  users.saveMyVerificationDocuments,
  account.documentsSaved
);

// Vouchers & Rewards
const voucherRoutes = express.Router();
voucherRoutes.use(protect);
voucherRoutes.get('/', vouchers.listVouchers);
voucherRoutes.get('/usable', vouchers.usableVouchers);
voucherRoutes.post('/lookup', vouchers.lookupCode);
voucherRoutes.post('/apply-code', vouchers.applyCode);
voucherRoutes.get('/:id', vouchers.getVoucher);
voucherRoutes.route('/:id/redeem').get(vouchers.redeemPreview).post(vouchers.redeem);

// Help Center (reading is open to everyone; Contact Us needs sign-in)
const helpRoutes = express.Router();
helpRoutes.get('/', help.home);
helpRoutes.get('/articles', help.articles);
helpRoutes.get('/articles/:id', help.article);
helpRoutes.post('/articles/:id/feedback', help.feedback);
helpRoutes.post('/contact', protect, help.contact);

// About App, Privacy Policy, Terms & Conditions
const pageRoutes = express.Router();
pageRoutes.get('/', pages.listPages);
pageRoutes.get('/:key', pages.getPage);

// Travel Agency Application (Become a Partner): the page, the 3-step form and the traveler's applications
const agencyApplicationRoutes = express.Router();
agencyApplicationRoutes.get('/', optionalAuth, agencyApplication.overview);
agencyApplicationRoutes.post('/check', protect, agencyApplication.checkStep);
agencyApplicationRoutes.post('/', protect, agencyApplicationUpload, agencyApplication.submit);
agencyApplicationRoutes.get('/mine', protect, agencyApplication.mine);
agencyApplicationRoutes.post('/:reference/reply', protect, applicationUpload, agencyApplication.findMineForReply, applications.reply);

module.exports = { app, feed, posts: postRoutes, comments, people: peopleRoutes, agencies: agencyRoutes, me: meRoutes, vouchers: voucherRoutes, help: helpRoutes, pages: pageRoutes, agencyApplication: agencyApplicationRoutes };
