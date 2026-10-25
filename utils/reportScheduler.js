const mongoose = require('mongoose');
const Agency = require('../models/agencyModel');
const { reportPeriod, dhakaDay } = require('./vendorReport');
const { sendReport } = require('./reportMailer');

/**
 * Sends scheduled vendor reports from inside the web server:
 *  daily reports every morning from 9:00 (Bangladesh time) for the day before,
 *  monthly reports on the 1st from 9:00 for the month before.
 * Each vendor gets each period once; a failed send is retried at most every 6 hours.
 * Set REPORT_SCHEDULER=off to disable (for example when running more than one server).
 * Set APP_URL (e.g. https://plezar.com) so the link in the email points at the live site.
 */
const CHECK_EVERY = 15 * 60 * 1000;
const RETRY_AFTER = 6 * 60 * 60 * 1000;
const SEND_FROM_HOUR = 9;

const dhakaHour = now => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hour12: false }).format(now));

const runOnce = async (now = new Date()) => {
  if (mongoose.connection.readyState !== 1) return { skipped: 'database not connected' };
  if (dhakaHour(now) < SEND_FROM_HOUR) return { skipped: 'before 9:00 in Dhaka' };

  const due = [];
  const daily = reportPeriod('daily', {}, now);
  due.push(['daily', daily]);
  if (dhakaDay(now).endsWith('-01')) due.push(['monthly', reportPeriod('monthly', {}, now)]);

  const results = [];
  await due.reduce((chain, [schedule, period]) => chain.then(async () => {
    const agencies = await Agency.find({
      status: 'active',
      'reports.schedule': schedule,
      'reports.lastKey': { $ne: period.key },
      $or: [{ 'reports.lastAttemptAt': null }, { 'reports.lastAttemptAt': { $lt: new Date(now.getTime() - RETRY_AFTER) } }, { 'reports.lastError': '' }]
    });
    await agencies.reduce((inner, agency) => inner.then(async () => {
      const outcome = await sendReport(agency, period, { baseURL: process.env.APP_URL || agency.reports.baseURL || `http://localhost:${process.env.PORT || 3000}`, alsoToAgencyEmail: agency.reports.alsoToAgencyEmail });
      agency.reports.lastAttemptAt = now;
      if (outcome.sentTo.length) {
        agency.reports.lastKey = period.key;
        agency.reports.lastSentAt = now;
        agency.reports.lastError = '';
      } else {
        agency.reports.lastError = outcome.noRecipients ? 'No owner email to send to.' : (outcome.failed[0] && outcome.failed[0].error) || 'Could not send.';
      }
      await agency.save({ validateBeforeSave: false });
      results.push({ agency: agency.name, period: period.key, sent: outcome.sentTo.length > 0 });
    }), Promise.resolve());
  }), Promise.resolve());
  return { results };
};

let timer = null;
const startReportScheduler = () => {
  if (process.env.REPORT_SCHEDULER === 'off' || timer) return;
  const tick = () => runOnce().then(r => {
    if (r.results && r.results.length) console.log(`[REPORTS] ${r.results.filter(x => x.sent).length} of ${r.results.length} scheduled reports sent`);
  }).catch(err => console.warn('[REPORTS WARNING]', err.message));
  timer = setInterval(tick, CHECK_EVERY);
  timer.unref();
  setTimeout(tick, 60 * 1000).unref();
};

module.exports = { startReportScheduler, runOnce };
