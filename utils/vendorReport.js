const Booking = require('../models/bookingModel');
const Payout = require('../models/payoutModel');
const Review = require('../models/reviewModel');
const Package = require('../models/packageModel');
const Broadcast = require('../models/broadcastModel');
const Announcement = require('../models/announcementModel');
const AppError = require('./appError');
const { earningsFor, PAID } = require('./earnings');
const { registrationStats } = require('./events');

// A vendor's performance over one day or one month, in Bangladesh time

const DHAKA = '+06:00';
const DAY = 24 * 60 * 60 * 1000;
const dhakaDay = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date); // YYYY-MM-DD
const dayStart = day => new Date(`${day}T00:00:00${DHAKA}`);

/**
 * The period a report covers.
 *  daily:   one day (date = YYYY-MM-DD, default yesterday)
 *  monthly: one month (month = YYYY-MM, default last month)
 */
const reportPeriod = (kind, { date, month } = {}, now = new Date()) => {
  if (kind === 'daily') {
    const day = date || dhakaDay(new Date(now.getTime() - DAY));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(dayStart(day).getTime())) throw new AppError('Choose a valid day.', 400);
    const from = dayStart(day);
    if (from > now) throw new AppError('Choose a day that has already started.', 400);
    return {
      kind,
      key: `D:${day}`,
      from,
      to: new Date(from.getTime() + DAY),
      label: from.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' })
    };
  }
  if (kind === 'monthly') {
    let m = month;
    if (!m) {
      const [y, mo] = dhakaDay(now).split('-').map(Number);
      const prev = mo === 1 ? [y - 1, 12] : [y, mo - 1];
      m = `${prev[0]}-${String(prev[1]).padStart(2, '0')}`;
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new AppError('Choose a valid month.', 400);
    const [y, mo] = m.split('-').map(Number);
    const from = dayStart(`${m}-01`);
    if (from > now) throw new AppError('Choose a month that has already started.', 400);
    const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    return {
      kind,
      key: `M:${m}`,
      from,
      to: dayStart(`${next}-01`),
      label: from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' })
    };
  }
  throw new AppError('Choose a daily or monthly report.', 400);
};

const first = rows => rows[0] || {};

const buildReport = async (agency, period) => {
  const id = agency._id;
  const range = { $gte: period.from, $lt: period.to };
  const soon = new Date(Math.max(period.to.getTime(), Date.now()) + 30 * DAY);

  const [created, cancelled, completed, paid, payouts, reviews, earnings, upcoming, notifications, announcements] = await Promise.all([
    Booking.aggregate([
      { $match: { agency: id, createdAt: range } },
      { $group: { _id: null, count: { $sum: 1 }, active: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] } }, travelers: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$travelers', 0] } }, value: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$amount', 0] } } } }
    ]),
    Booking.countDocuments({ agency: id, cancelledAt: range }),
    Booking.aggregate([{ $match: { agency: id, completedAt: range } }, { $group: { _id: null, count: { $sum: 1 }, travelers: { $sum: '$travelers' } } }]),
    Booking.aggregate([{ $match: { agency: id, paidAt: range, paymentStatus: { $in: PAID } } }, { $group: { _id: null, amount: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }]),
    Payout.aggregate([{ $match: { agency: id, status: 'paid', paidAt: range } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Review.aggregate([{ $match: { agency: id, createdAt: range } }, { $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$rating' } } }]),
    earningsFor(id),
    Package.find({ agency: id, status: 'published', startDate: { $gte: new Date(), $lt: soon } }).sort({ startDate: 1 }).limit(10).select('title startDate seats').lean(),
    Broadcast.countDocuments({ agency: id, createdAt: range }),
    Announcement.countDocuments({ agency: id, publishedAt: range })
  ]);
  const evStats = await registrationStats(upcoming.map(e => e._id));
  const c = first(created);
  const p = first(paid);

  return {
    agency: { _id: id, name: agency.name },
    period: { kind: period.kind, key: period.key, label: period.label, from: period.from, to: period.to },
    registrations: { new: c.active || 0, travelers: c.travelers || 0, value: c.value || 0, cancelled },
    trips: { completed: first(completed).count || 0, travelers: first(completed).travelers || 0 },
    money: {
      paid: p.amount || 0,
      commission: Math.round((p.commission || 0) * 100) / 100,
      earned: Math.round(((p.amount || 0) - (p.commission || 0)) * 100) / 100,
      payoutsPaid: first(payouts).amount || 0,
      payoutsPaidCount: first(payouts).count || 0,
      available: earnings.available,
      pendingPayouts: earnings.pendingPayouts
    },
    reviews: { count: first(reviews).count || 0, average: first(reviews).average ? Math.round(first(reviews).average * 10) / 10 : null },
    activity: { notifications, announcements },
    upcoming: upcoming.map(e => {
      const s = evStats[String(e._id)] || { seatsTaken: 0 };
      return { title: e.title, startDate: e.startDate, seats: e.seats || null, seatsTaken: s.seatsTaken };
    })
  };
};

const taka = n => `Tk ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// Plain-text version, for copying into an email by hand when the server can't send one
const reportText = r => [
  `${r.agency.name}: ${r.period.kind === 'daily' ? 'daily' : 'monthly'} report for ${r.period.label}`,
  '',
  `New registrations: ${r.registrations.new} (${r.registrations.travelers} travelers, ${taka(r.registrations.value)})`,
  `Cancelled: ${r.registrations.cancelled}`,
  `Trips completed: ${r.trips.completed} (${r.trips.travelers} travelers)`,
  `Payments received: ${taka(r.money.paid)}`,
  `Plejar commission: ${taka(r.money.commission)}`,
  `Your earnings: ${taka(r.money.earned)}`,
  `Payouts sent to you: ${taka(r.money.payoutsPaid)}`,
  `Available to pay out now: ${taka(r.money.available)}${r.money.pendingPayouts ? ` (${taka(r.money.pendingPayouts)} already requested)` : ''}`,
  `New reviews: ${r.reviews.count}${r.reviews.average ? ` (average ${r.reviews.average} of 5)` : ''}`,
  '',
  r.upcoming.length ? 'Coming up:' : 'No published tour events in the next 30 days.',
  ...r.upcoming.map(e => `- ${e.title}, ${new Date(e.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}: ${e.seatsTaken}${e.seats ? ` of ${e.seats}` : ''} seats taken`)
].join('\n');

module.exports = { reportPeriod, buildReport, reportText, dhakaDay };
