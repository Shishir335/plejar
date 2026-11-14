const mongoose = require('mongoose');
const Agency = require('../models/agencyModel');
const Package = require('../models/packageModel');
const User = require('../models/userModel');
const AgentLead = require('../models/agentLeadModel');
const Subscriber = require('../models/subscriberModel');
const Hotel = require('../models/hotelModel');
const Booking = require('../models/bookingModel');
const StayRequest = require('../models/stayRequestModel');
const catchAsync = require('../utils/catchAsync');

const TZ = 'Asia/Dhaka';
const DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// YYYY-MM-DD in Dhaka time (Bangladesh has no daylight saving, so fixed-day steps are safe)
const dhakaDay = date => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);

const lastDays = (count = DAYS) => {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => dhakaDay(new Date(now - (count - 1 - i) * DAY_MS)));
};

const dayFormat = field => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ } });

// Fill a day -> count aggregation into a zero-filled array aligned with `dates`
const toSeries = (rows, dates) => {
  const map = new Map(rows.map(r => [r._id, r.count]));
  return dates.map(d => map.get(d) || 0);
};

const sum = arr => arr.reduce((a, b) => a + b, 0);

const countBy = (rows, key, order) => {
  const map = new Map(rows.map(r => [r._id, r.count]));
  return order.map(k => ({ [key]: k, count: map.get(k) || 0 }));
};

const hotelAttention = async () => {
  const [hotelLeads, hotelPendingVerification, draftListings] = await Promise.all([
    AgentLead.countDocuments({ status: 'new', vendorType: 'hotel' }),
    Agency.countDocuments({ kind: 'hotel', 'verification.status': 'pending' }),
    Hotel.countDocuments({ status: 'draft', agency: { $ne: null } })
  ]);
  return { hotelLeads, hotelPendingVerification, draftListings };
};

/**
 * App or website, over the last 30 days (utils/client.js): people active on each, bookings and stay
 * requests made on each, and the app versions people are on. Users count once per client they used.
 * Older app builds (before the client header) show as "App (older build)".
 */
const clientUse = async since => {
  const [android, ios, olderApp, web, bookings, stays, versions] = await Promise.all([
    User.countDocuments({ 'seen.app.at': { $gte: since }, 'seen.app.platform': 'android' }),
    User.countDocuments({ 'seen.app.at': { $gte: since }, 'seen.app.platform': 'ios' }),
    User.countDocuments({ 'seen.app.at': { $gte: since }, 'seen.app.platform': { $nin: ['android', 'ios'] } }),
    User.countDocuments({ 'seen.web.at': { $gte: since } }),
    Booking.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $ifNull: ['$source.type', 'unknown'] }, count: { $sum: 1 } } }]),
    StayRequest.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $ifNull: ['$source.type', 'unknown'] }, count: { $sum: 1 } } }]),
    User.aggregate([
      { $match: { 'seen.app.at': { $gte: since }, 'seen.app.version': { $nin: [null, ''] } } },
      { $group: { _id: '$seen.app.version', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 }
    ])
  ]);
  const made = ['app', 'web', 'unknown'].map(key => ({
    key,
    count: [...bookings, ...stays].filter(r => r._id === key).reduce((n, r) => n + r.count, 0)
  }));
  return {
    activeUsers: [
      { key: 'android', count: android },
      { key: 'ios', count: ios },
      { key: 'app_older', count: olderApp },
      { key: 'web', count: web }
    ],
    bookings: made,
    appVersions: versions.map(v => ({ version: v._id, count: v.count }))
  };
};

exports.getDashboard = catchAsync(async (req, res, next) => {
  const dates = lastDays();
  const since = new Date(Date.now() - DAYS * DAY_MS);
  const sinceId = mongoose.Types.ObjectId.createFromTime(Math.floor(since.getTime() / 1000));

  const [
    userRoles,
    usersDaily,
    leadStatus,
    leadsDaily,
    agencyStatus,
    agencyVerification,
    agenciesDaily,
    invitedOwners,
    packageStatus,
    subscriberStatus,
    subscribersDaily,
    topPackageRows,
    recentLeads,
    recentAgencies,
    recentUsers,
    recentSubscribers
  ] = await Promise.all([
    // A person with several roles counts once under each
    User.aggregate([
      { $match: { active: { $ne: false } } },
      { $project: { roles: { $cond: [{ $gt: [{ $size: { $ifNull: ['$roles', []] } }, 0] }, '$roles', ['$role']] } } },
      { $unwind: '$roles' },
      { $group: { _id: '$roles', count: { $sum: 1 } } }
    ]),
    User.aggregate([
      { $match: { _id: { $gte: sinceId }, active: { $ne: false } } },
      { $group: { _id: dayFormat({ $toDate: '$_id' }), count: { $sum: 1 } } }
    ]),
    AgentLead.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    AgentLead.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: dayFormat('$createdAt'), count: { $sum: 1 } } }
    ]),
    Agency.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Agency.aggregate([
      { $group: { _id: { verified: '$verified', status: '$verification.status' }, count: { $sum: 1 } } }
    ]),
    Agency.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: dayFormat('$createdAt'), count: { $sum: 1 } } }
    ]),
    User.countDocuments({ role: 'agent', agencyRole: 'owner', accountStatus: 'invited' }),
    Package.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Subscriber.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Subscriber.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: dayFormat('$createdAt'), count: { $sum: 1 } } }
    ]),
    Package.aggregate([
      { $match: { status: 'published' } },
      { $group: { _id: '$agency', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]),
    AgentLead.find().sort({ createdAt: -1 }).limit(5).select('agencyName contactName phone regions status createdAt').lean(),
    Agency.find().sort({ createdAt: -1 }).limit(5).select('name logo regions status verified verification.status createdAt').lean(),
    User.find().sort({ _id: -1 }).limit(5).select('name email role roles accountStatus').lean(),
    Subscriber.find().sort({ createdAt: -1 }).limit(5).select('email source status createdAt').lean()
  ]);

  const series = {
    dates,
    users: toSeries(usersDaily, dates),
    leads: toSeries(leadsDaily, dates),
    subscribers: toSeries(subscribersDaily, dates),
    agencies: toSeries(agenciesDaily, dates)
  };
  const week = arr => sum(arr.slice(-7));

  const roleOrder = ['user', 'agent', 'manager', 'admin', 'dev'];
  const leadOrder = ['new', 'reviewing', 'needs_info', 'approved', 'rejected', 'contacted', 'archived'];
  const agencyOrder = ['active', 'suspended', 'deactivated'];
  const packageOrder = ['published', 'draft', 'hidden'];
  const subOrder = ['active', 'unsubscribed'];

  const byRole = countBy(userRoles, 'role', roleOrder);
  const leads = countBy(leadStatus, 'status', leadOrder);
  const agencies = countBy(agencyStatus, 'status', agencyOrder);
  const packages = countBy(packageStatus, 'status', packageOrder);
  const subscribers = countBy(subscriberStatus, 'status', subOrder);
  const get = (list, key, value) => (list.find(i => i[key] === value) || { count: 0 }).count;

  // Verification funnel: verified, awaiting review, changes requested, not submitted
  const verification = { verified: 0, pending: 0, rejected: 0, none: 0 };
  agencyVerification.forEach(r => {
    const { verified, status } = r._id;
    if (verified) verification.verified += r.count;
    else if (status === 'pending') verification.pending += r.count;
    else if (status === 'rejected') verification.rejected += r.count;
    else verification.none += r.count;
  });

  const topAgencyDocs = await Agency.find({ _id: { $in: topPackageRows.map(r => r._id) } })
    .select('name logo verified')
    .lean();
  const topAgencies = topPackageRows
    .map(r => {
      const a = topAgencyDocs.find(d => String(d._id) === String(r._id));
      return a ? { id: a._id, name: a.name, logo: a.logo, verified: a.verified, publishedPackages: r.count } : null;
    })
    .filter(Boolean);

  const totalUsers = sum(byRole.map(r => r.count));
  const totalAgencies = sum(agencies.map(r => r.count));
  const totalPackages = sum(packages.map(r => r.count));
  const totalLeads = sum(leads.map(r => r.count));
  const totalSubs = sum(subscribers.map(r => r.count));

  res.status(200).json({
    status: 'success',
    data: {
      generatedAt: new Date().toISOString(),
      totals: {
        users: { total: totalUsers, week: week(series.users) },
        agencies: {
          total: totalAgencies,
          active: get(agencies, 'status', 'active'),
          suspended: get(agencies, 'status', 'suspended'),
          verified: verification.verified,
          week: week(series.agencies)
        },
        leads: { total: totalLeads, new: get(leads, 'status', 'new'), week: week(series.leads) },
        packages: {
          total: totalPackages,
          published: get(packages, 'status', 'published'),
          draft: get(packages, 'status', 'draft'),
          hidden: get(packages, 'status', 'hidden')
        },
        subscribers: { total: totalSubs, active: get(subscribers, 'status', 'active'), week: week(series.subscribers) }
      },
      attention: {
        newLeads: get(leads, 'status', 'new'),
        pendingVerification: verification.pending,
        invitedOwners,
        // The hotels' share of the two above, so the dashboard can send each to Travel agents or Hotels
        ...(await hotelAttention())
      },
      // The app or the website (users.seen, bookings' and stays' source)
      clients: await clientUse(since),
      breakdowns: {
        userRoles: byRole,
        leadStatus: leads,
        verification: [
          { key: 'verified', count: verification.verified },
          { key: 'pending', count: verification.pending },
          { key: 'rejected', count: verification.rejected },
          { key: 'none', count: verification.none }
        ],
        packageStatus: packages,
        agencyStatus: agencies
      },
      series,
      topAgencies,
      recent: {
        leads: recentLeads,
        agencies: recentAgencies.map(a => ({
          id: a._id,
          name: a.name,
          logo: a.logo,
          regions: a.regions,
          status: a.status,
          verified: a.verified,
          verificationStatus: a.verification ? a.verification.status : 'none',
          createdAt: a.createdAt
        })),
        users: recentUsers.map(u => ({
          id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          roles: u.roles && u.roles.length ? u.roles : [u.role],
          accountStatus: u.accountStatus,
          // Accounts don't store a creation date, but their ID does
          createdAt: u._id.getTimestamp()
        })),
        subscribers: recentSubscribers
      }
    }
  });
});
