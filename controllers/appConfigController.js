const Reaction = require('../models/reactionModel');
const SocialReport = require('../models/socialReportModel');
const { MAX_MEDIA, MAX_VIDEO, MAX_IMAGE } = require('../utils/social');

// What the mobile app needs at start-up: its tabs, which features are switched on, and the limits.
// Restaurants, Transport and live streaming are in the design but not built yet, so the app can
// show them as "coming soon".
const comingSoon = (title, message) => ({ enabled: false, status: 'coming_soon', title, message });

const RESTAURANTS = comingSoon('Restaurants are coming soon', 'Soon you will find places to eat near your destination, with menus and prices.');
const TRANSPORT = comingSoon('Transport is coming soon', 'Soon you will compare buses, trains, launches and flights to your destination.');

const LIVE = {
  enabled: false,
  status: 'coming_soon',
  title: 'Live streaming is coming soon',
  message: 'Soon you will be able to go live from your trips and watch agencies stream their tours.'
};

exports.config = (req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      // The bottom tab bar, left to right. `api` is where each tab gets its content.
      tabs: [
        { key: 'home', label: 'Home', labelBn: 'হোম', icon: 'home', enabled: true, api: '/api/v1/feed' },
        { key: 'tours', label: 'Tours', labelBn: 'ট্যুর', icon: 'location', enabled: true, api: '/api/v1/tours/home' },
        { key: 'hotels', label: 'Hotels', labelBn: 'হোটেল', icon: 'hotel', enabled: true, api: '/api/v1/hotels' },
        { key: 'restaurants', label: 'Restaurants', labelBn: 'রেস্টুরেন্ট', icon: 'restaurant', enabled: RESTAURANTS.enabled, badge: 'Soon', comingSoon: RESTAURANTS },
        { key: 'transport', label: 'Transport', labelBn: 'যাতায়াত', icon: 'transport', enabled: TRANSPORT.enabled, badge: 'Soon', comingSoon: TRANSPORT }
      ],
      // The tab that opens first
      initialTab: 'home',
      // The top bar: the bell opens notifications, the round button on "My Account" opens the profile
      header: {
        notifications: { api: '/api/v1/notifications', unreadApi: '/api/v1/notifications/unread-count' },
        profile: { api: '/api/v1/me/profile' }
      },
      // The ☰ menu, top to bottom as in the design. `ready: false` items are still being built.
      menu: [
        { key: 'my_booking', label: 'My Booking', labelBn: 'আমার বুকিং', icon: 'booking', api: '/api/v1/bookings/mine', ready: true },
        { key: 'travel_history', label: 'Travel History', labelBn: 'ভ্রমণের ইতিহাস', icon: 'history', api: '/api/v1/me/travel-history', extraApi: '/api/v1/me/rewards', ready: true },
        { key: 'notifications', label: 'Notifications', labelBn: 'নোটিফিকেশন', icon: 'bell', api: '/api/v1/notifications', ready: true },
        { key: 'chat', label: 'Chat', labelBn: 'চ্যাট', icon: 'chat', api: '/api/v1/conversations', unreadApi: '/api/v1/conversations/unread-count', ready: true },
        { key: 'wishlist', label: 'Wishlist', labelBn: 'পছন্দের তালিকা', icon: 'heart', api: '/api/v1/me/wishlist', ready: true },
        { key: 'id_verification', label: 'ID Verification', labelBn: 'আইডি যাচাই', icon: 'verified', api: '/api/v1/me/verification', ready: true },
        { key: 'vouchers_rewards', label: 'Voucher & Rewards', labelBn: 'ভাউচার ও রিওয়ার্ড', icon: 'gift', api: '/api/v1/vouchers', extraApi: '/api/v1/me/points', ready: true },
        { key: 'refer_friends', label: 'Refer Friends', labelBn: 'বন্ধুদের আমন্ত্রণ', icon: 'share', api: '/api/v1/me/referrals', ready: true },
        { key: 'help_center', label: 'Help Center', labelBn: 'সহায়তা কেন্দ্র', icon: 'help', api: '/api/v1/help', ready: true },
        { key: 'agency_application', label: 'Agency Application', labelBn: 'এজেন্সি আবেদন', icon: 'agency', api: '/api/v1/agency-application', ready: true },
        { key: 'about_app', label: 'About App', labelBn: 'অ্যাপ সম্পর্কে', icon: 'info', api: '/api/v1/pages/about', ready: true },
        { key: 'privacy_policy', label: 'Privacy Policy', labelBn: 'গোপনীয়তা নীতি', icon: 'shield', api: '/api/v1/pages/privacy', ready: true },
        { key: 'terms', label: 'Term & Condition', labelBn: 'শর্তাবলী', icon: 'document', api: '/api/v1/pages/terms', ready: true }
      ],
      logout: { label: 'Log out', labelBn: 'লগ আউট', api: '/api/v1/auth/logout' },
      features: { posts: true, comments: true, reactions: Reaction.KINDS, shares: true, follows: true, tours: true, hotels: true, restaurants: RESTAURANTS, transport: TRANSPORT, liveStreaming: LIVE },
      limits: { postText: 5000, commentText: 2000, mediaPerPost: MAX_MEDIA, videosPerPost: 1, photoMB: MAX_IMAGE / 1024 / 1024, videoMB: MAX_VIDEO / 1024 / 1024, bio: 300 },
      audiences: ['public', 'followers', 'private'],
      reportReasons: SocialReport.REASONS
    }
  });
};

// The Live tab: nothing to watch yet
exports.live = (req, res) => {
  res.status(200).json({ status: 'success', data: { ...LIVE, streams: [] } });
};

exports.startLive = (req, res) => {
  res.status(501).json({ status: 'fail', message: LIVE.title, data: LIVE });
};
