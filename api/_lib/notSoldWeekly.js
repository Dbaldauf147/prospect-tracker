// Shared "Not Sold last week" helpers used by the scheduled-email cron
// (api/not-sold-weekly-scheduler.js) and the "send now" route
// (api/not-sold-weekly-send-now.js).
//
// The rows are the opps this user marked Not Sold in the seven days before
// the send (src/utils/notSoldWeeklyEmail.js), read from their `opps2Data`
// doc so a schedule can fire with no browser open. Sent from the same Gmail
// account as the New Opps and PE Monthly emails.
//
// "Today" is the server's day (UTC), and a Close Date is a calendar day, so
// a send late in a US evening counts the day just ending as part of the
// week. The morning sends this is meant for are the same day in both.

import { loadOpps2Records, sendHtmlEmail } from './newOpps.js';
import { notSoldLastWeek, buildNotSoldWeeklyEmailHtml, NOT_SOLD_WEEKLY_DEFAULTS } from '../../src/utils/notSoldWeeklyEmail.js';

export async function loadNotSoldLastWeek(db, uid, nowMs = Date.now()) {
  return notSoldLastWeek(await loadOpps2Records(db, uid), { nowMs });
}

export async function sendNotSoldWeeklyEmail({ to, subject, message, rows, replyTo, nowMs = Date.now() }) {
  const html = buildNotSoldWeeklyEmailHtml(rows, { message, nowMs });
  return sendHtmlEmail({ to, subject: subject || NOT_SOLD_WEEKLY_DEFAULTS.subject, html, replyTo });
}
