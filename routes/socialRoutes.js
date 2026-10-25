const express = require('express');
const authController = require('../controllers/authController');
const posts = require('../controllers/postController');
const people = require('../controllers/peopleController');
const agencies = require('../controllers/agencyDirectoryController');
const me = require('../controllers/meController');
const appConfig = require('../controllers/appConfigController');
const { postMediaUpload } = require('../utils/social');
const { profileUpload } = require('../utils/userImages');

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
agencyRoutes.route('/:id/follow').post(protect, agencies.follow).delete(protect, agencies.unfollow);

// Settings tab
const meRoutes = express.Router();
meRoutes.use(protect);
meRoutes.route('/profile').get(me.getProfile).patch(profileUpload, me.updateProfile);
meRoutes.route('/settings').get(me.getSettings).patch(me.updateSettings);
meRoutes.get('/saved', me.savedPosts);
meRoutes.get('/blocked', me.blocked);
meRoutes.get('/following-agencies', me.followingAgencies);

module.exports = { app, feed, posts: postRoutes, comments, people: peopleRoutes, agencies: agencyRoutes, me: meRoutes };
