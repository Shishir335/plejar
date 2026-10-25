const Reaction = require('../models/reactionModel');
const SocialReport = require('../models/socialReportModel');
const { MAX_MEDIA, MAX_VIDEO, MAX_IMAGE } = require('../utils/social');

// What the mobile app needs at start-up: its tabs, which features are switched on, and the limits.
// Live streaming is part of the design but not built yet, so the app can show it as "coming soon".
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
      tabs: [
        { key: 'home', label: 'Home', labelBn: 'হোম', icon: 'home', enabled: true },
        { key: 'agents', label: 'Agents', labelBn: 'এজেন্ট', icon: 'agency', enabled: true },
        { key: 'live', label: 'Live', labelBn: 'লাইভ', icon: 'live', enabled: LIVE.enabled, badge: 'Soon' },
        { key: 'notifications', label: 'Notifications', labelBn: 'নোটিফিকেশন', icon: 'bell', enabled: true },
        { key: 'settings', label: 'Settings', labelBn: 'সেটিংস', icon: 'settings', enabled: true }
      ],
      features: { posts: true, comments: true, reactions: Reaction.KINDS, shares: true, follows: true, liveStreaming: LIVE },
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
