// The monthly Changed Jobs email: the people on the Changed Jobs page's
// "Other contacts" subtab (left for an outside company; former Schneider
// Electric coworkers are not included), minus anyone hidden from the page.
//
//   Vercel Cron (vercel.json, the 1st of each month)
//                         build and email it; Authorization:
//                         Bearer <CRON_SECRET>. A month already sent is not
//                         sent again (Vercel can fire a cron twice).
//   POST ?action=send     the same, now (admin only), for the page's
//                         "Email me this now" button; always sends
//   GET  ?action=status   when it goes, where, and the last run (admin only)
//
// Env:
//   CHANGED_JOBS_MONTHLY_TO    where it goes (comma separated; default the
//                              admin account's address)
//   HUBSPOT_ACCESS_TOKEN, GMAIL_USER / GMAIL_APP_PASSWORD, CRON_SECRET,
//   FIREBASE_SERVICE_ACCOUNT_KEY
//
// Contacts are read live from HubSpot (read only) and the admin's settings
// from Firestore, then run through the same selector the page uses (see
// src/utils/changedJobsMonthly.js). Each run is logged to
// changedJobsMonthly/latest.

import { withAuth, isAdminEmail } from './_lib/http.js';
import { adminDb, adminAuth } from './_lib/firebaseAdmin.js';
import { hubspotScope } from './_lib/hubspotScope.js';
import { readUserSettings } from './_lib/readUserSettings.js';
import { sendEmail } from './_lib/mailer.js';
import { getAllContacts } from './hubspot.js';
import { flatContact } from './_lib/hubspotWeekly.js';
import { buildChangedJobsMonthly } from '../src/utils/changedJobsMonthly.js';
import { changedJobsMonthlySubject, renderChangedJobsMonthlyHtml } from './_lib/changedJobsMonthlyEmail.js';

const ADMIN_EMAIL = 'baldaufdan@gmail.com';

// vercel.json runs it at 13:20 UTC on the 1st of every month.
export const SCHEDULE_TEXT = 'The 1st of every month at 8:20am Eastern (9:20am in summer)';

export function recipientsFromEnv(env = process.env) {
  return String(env.CHANGED_JOBS_MONTHLY_TO || ADMIN_EMAIL).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

async function loadSources(db, env = process.env) {
  const token = env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN is not configured.');
  const uid = (await adminAuth().getUserByEmail(ADMIN_EMAIL)).uid;
  const [settings, scope] = await Promise.all([readUserSettings(db, uid), hubspotScope(token)]);
  const contacts = (await getAllContacts(token, scope)).map(flatContact);
  return { contacts, settings: settings || {} };
}

/** Build and send one month's email. Returns the log entry it wrote. */
export async function runMonthly({
  db, env = process.env, load = loadSources, send = sendEmail, now = () => Date.now(), fromCron = false,
}) {
  const to = recipientsFromEnv(env);
  const startedMs = now();
  const startedAt = new Date(startedMs).toISOString();
  const log = db.collection('changedJobsMonthly').doc('latest');
  try {
    const { contacts, settings } = await load(db, env);
    const report = buildChangedJobsMonthly(contacts, settings, { nowMs: startedMs });
    if (fromCron) {
      const last = await log.get().then(s => (s.exists ? s.data() : null)).catch(() => null);
      if (last?.ok && last.month === report.month.key && last.fromCron) {
        return { ...last, skipped: 'already sent for this month' };
      }
    }
    await send({ to, subject: changedJobsMonthlySubject(report), html: renderChangedJobsMonthlyHtml(report) });
    const entry = {
      ok: true, fromCron, startedAt, finishedAt: new Date(now()).toISOString(), to,
      month: report.month.key, ...report.totals, error: null,
    };
    await log.set(entry).catch(() => {});
    return entry;
  } catch (err) {
    const entry = { ok: false, fromCron, startedAt, finishedAt: new Date(now()).toISOString(), to, error: String(err?.message || err).slice(0, 500) };
    await log.set(entry).catch(() => {});
    return entry;
  }
}

const authed = withAuth(async (req, res, auth) => {
  if (!isAdminEmail(auth?.email)) return res.status(403).json({ error: 'Only the admin account can send the monthly Changed Jobs email.' });
  const db = adminDb();
  const action = req.query?.action;
  if (action === 'status') {
    const snap = await db.collection('changedJobsMonthly').doc('latest').get();
    return res.json({ schedule: SCHEDULE_TEXT, to: recipientsFromEnv(), last: snap.exists ? snap.data() : null });
  }
  if (action === 'send' && req.method === 'POST') {
    const entry = await runMonthly({ db });
    return res.status(entry.ok ? 200 : 500).json(entry);
  }
  return res.status(400).json({ error: 'Missing or invalid action parameter.' });
});

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const header = String(req.headers?.authorization || '');
  if (secret && header === `Bearer ${secret}`) {
    const entry = await runMonthly({ db: adminDb(), fromCron: true });
    return res.status(entry.ok ? 200 : 500).json(entry);
  }
  return authed(req, res);
}
