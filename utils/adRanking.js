/**
 * Which banners and agents' ads a traveler sees, and in what order.
 *
 * The slider on the Tours screen holds up to SLIDES banners: Plejar's own banners first (at most
 * PINNED, in the admin's order), then agents' ads. Ads are grouped by how near the tour starts to the
 * traveler (same district, same division, anywhere else). Within a group the ad that has been shown
 * least for the time it has been live goes first, so every accepted ad gets its turn however many
 * there are. The "all ads" list uses the same groups with a per-visit shuffle instead, so it doesn't
 * change order while the traveler scrolls through its pages.
 */
const crypto = require('crypto');
const Promotion = require('../models/promotionModel');
const Package = require('../models/packageModel');
const Agency = require('../models/agencyModel');
const { district, nearestDistrict, tourStartDistrict } = require('./places');

const SLIDES = 8;
const PINNED = 3;
const TOUR_FIELDS = 'title agency status hiddenByAdmin startDate endDate priceFrom regularPrice photos destination startDistrict meetingPoint itinerary.stops.place';

/**
 * Where the traveler is, as a district: the phone's location, a district code the app sends, or the
 * district of the signed-in traveler's default address. Null when none of these is known.
 */
const viewerDistrict = ({ lat, lng, districtCode, user } = {}) => {
  const fromPoint = nearestDistrict(Number(lat), Number(lng));
  if (fromPoint) return fromPoint;
  const sent = district(districtCode);
  if (sent) return sent;
  const addresses = (user && user.addresses) || [];
  const home = addresses.find(a => a.isDefault) || addresses[0];
  return home ? district(home.districtCode) : null;
};

// 0 same district, 1 same division, 2 anywhere else or unknown
const nearness = (viewer, start) => {
  if (!viewer || !start) return 2;
  if (viewer.code === start.code) return 0;
  return viewer.division.code === start.division.code ? 1 : 2;
};

/**
 * Everything live now: Plejar's banners in the admin's order, and agents' ads whose tour is still
 * published and whose agency is active, each with its tour and where the tour starts.
 */
const liveNow = async () => {
  const rows = await Promotion.find(Promotion.liveFilter()).sort({ order: 1, createdAt: -1 }).lean();
  const banners = rows.filter(p => p.source !== 'vendor');
  const adRows = rows.filter(p => p.source === 'vendor' && p.tour);
  if (!adRows.length) return { banners, ads: [] };

  const tours = await Package.find({ _id: { $in: adRows.map(p => p.tour) }, status: 'published', hiddenByAdmin: { $ne: true } }).select(TOUR_FIELDS).lean();
  const agencies = await Agency.find({ _id: { $in: [...new Set(tours.map(t => String(t.agency)))] }, status: 'active' }).select('name logo verified').lean();
  const agencyById = new Map(agencies.map(a => [String(a._id), a]));
  const tourById = new Map(tours.filter(t => agencyById.has(String(t.agency))).map(t => [String(t._id), { ...t, agency: agencyById.get(String(t.agency)) }]));
  const ads = adRows
    .filter(p => tourById.has(String(p.tour)))
    .map(p => {
      const tour = tourById.get(String(p.tour));
      return { ...p, tourDoc: tour, start: tourStartDistrict(tour) };
    });
  return { banners, ads };
};

// Views per hour since the ad went live: fair between an ad live for a month and one from today
const viewRate = (ad, now) => {
  const since = new Date(ad.startsAt || ad.reviewedAt || ad.createdAt).getTime();
  const hours = Math.max((now - since) / 3600000, 1);
  return (ad.views || 0) / hours;
};

const shuffleKey = (seed, id) => crypto.createHash('md5').update(`${seed}:${id}`).digest('hex');

/** Count a view for each ad shown; a failure is logged, never shown to the traveler */
const countViews = ads => {
  if (!ads.length) return;
  Promotion.updateMany({ _id: { $in: ads.map(a => a._id) } }, { $inc: { views: 1 }, $set: { lastShownAt: new Date() } })
    .catch(err => console.error('[ADS] Could not count views:', err.message));
};

/**
 * The slider for one traveler: { slides, adsTotal, district }. With `count`, each ad shown counts a view.
 */
const sliderFor = async (viewer, { count = false, limit = SLIDES } = {}) => {
  const { banners, ads } = await liveNow();
  const now = Date.now();
  const pinned = banners.slice(0, Math.min(PINNED, limit));
  const ranked = ads
    .map(ad => ({ ad, tier: nearness(viewer, ad.start), rate: viewRate(ad, now), tie: Math.random() }))
    .sort((a, b) => a.tier - b.tier || a.rate - b.rate || a.tie - b.tie)
    .map(r => r.ad);
  const shownAds = ranked.slice(0, Math.max(limit - pinned.length, 0));
  if (count) countViews(shownAds);
  return { slides: [...pinned, ...shownAds], adsTotal: ads.length };
};

/**
 * One page of every live ad, nearest first, for the "See all" screen. The same `seed` gives the same
 * order, so pages follow on from each other. Each ad on the page counts a view.
 */
const allAdsPage = async (viewer, { seed, page = 1, limit = 10 } = {}) => {
  const { ads } = await liveNow();
  const ordered = ads
    .map(ad => ({ ad, tier: nearness(viewer, ad.start), key: shuffleKey(seed, ad._id) }))
    .sort((a, b) => a.tier - b.tier || (a.key < b.key ? -1 : 1))
    .map(r => ({ ...r.ad, nearness: ['district', 'division', 'other'][r.tier] }));
  const rows = ordered.slice((page - 1) * limit, page * limit);
  countViews(rows);
  return { rows, total: ordered.length };
};

const newSeed = () => crypto.randomBytes(6).toString('hex');

module.exports = { SLIDES, viewerDistrict, sliderFor, allAdsPage, newSeed };
