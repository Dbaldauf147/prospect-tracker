// The quarterly Close Rates email (Opps > Close Rates, for the quarter that
// just ended, with every closed opp behind it at the end).
//
//   Vercel Cron (vercel.json, the 1st of Jan / Apr / Jul / Oct)
//                         build and email it; Authorization:
//                         Bearer <CRON_SECRET>. A quarter already sent
//                         is not sent again (Vercel can fire a cron twice).
//   POST ?action=send     the same, now (admin only), for the tab's
//                         "Email it now" button; always sends
//   GET  ?action=status   when it goes, where, and the last run (admin only)
//
// Env:
//   CLOSE_RATES_QUARTERLY_TO   where it goes (comma separated; default the
//                              admin account's address)
//   GMAIL_USER / GMAIL_APP_PASSWORD, CRON_SECRET, FIREBASE_SERVICE_ACCOUNT_KEY
//
// Built from the admin account's Opps (opps2Data) and settings at send
// time, through the same functions the tab uses (see
// src/utils/closeRatesQuarterly.js). Each run is logged to
// closeRatesQuarterly/latest.

import { withAuth, isAdminEmail } from './_lib/http.js';
import { adminDb, adminAuth } from './_lib/firebaseAdmin.js';
import { loadOpps2 } from './_lib/firestoreChunks.js';
import { readUserSettings } from './_lib/readUserSettings.js';
import { sendEmail } from './_lib/mailer.js';
import { buildCloseRatesQuarterly } from '../src/utils/closeRatesQuarterly.js';
import {
  renderCloseRatesQuarterlyHtml, closeRatesQuarterlySubject, closeRatesQuarterlyWorkbook,
} from './_lib/closeRatesQuarterlyEmail.js';

const ADMIN_EMAIL = 'baldaufdan@gmail.com';

// vercel.json runs it at 13:00 UTC on the 1st of each quarter's first month.
export const SCHEDULE_TEXT = 'The 1st of January, April, July and October at 8am Eastern (9am in summer)';

export function recipientsFromEnv(env = process.env) {
  return String(env.CLOSE_RATES_QUARTERLY_TO || ADMIN_EMAIL).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

async function loadSources(db) {
  const uid = (await adminAuth().getUserByEmail(ADMIN_EMAIL)).uid;
  const [opps, settings] = await Promise.all([loadOpps2(db, uid), readUserSettings(db, uid)]);
  return { records: Array.isArray(opps?.records) ? opps.records : [], settings: settings || {} };
}

/** Build and send one quarter's email. Returns the log entry it wrote. */
export async function runQuarterly({
  db, env = process.env, load = loadSources, send = sendEmail, now = () => Date.now(), fromCron = false,
}) {
  const to = recipientsFromEnv(env);
  const startedMs = now();
  const startedAt = new Date(startedMs).toISOString();
  const log = db.collection('closeRatesQuarterly').doc('latest');
  try {
    const { records, settings } = await load(db);
    const report = buildCloseRatesQuarterly(records, settings, { nowMs: startedMs });
    if (fromCron) {
      const last = await log.get().then(s => (s.exists ? s.data() : null)).catch(() => null);
      if (last?.ok && last.quarter === report.quarter.key && last.fromCron) {
        return { ...last, skipped: 'already sent for this quarter' };
      }
    }
    const content = await closeRatesQuarterlyWorkbook(report);
    await send({
      to,
      subject: closeRatesQuarterlySubject(report),
      html: renderCloseRatesQuarterlyHtml(report),
      attachments: [{
        filename: `Close rates ${report.quarter.label}.xlsx`,
        content,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
    });
    const h = report.headline.quarter;
    const entry = {
      ok: true, fromCron, startedAt, finishedAt: new Date(now()).toISOString(), to,
      quarter: report.quarter.key, oppCount: report.opps.length,
      rate: h ? Math.round(h.rate) : null, error: null,
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
  if (!isAdminEmail(auth?.email)) return res.status(403).json({ error: 'Only the admin account can send the quarterly close rates email.' });
  const db = adminDb();
  const action = req.query?.action;
  if (action === 'status') {
    const snap = await db.collection('closeRatesQuarterly').doc('latest').get();
    return res.json({ schedule: SCHEDULE_TEXT, to: recipientsFromEnv(), last: snap.exists ? snap.data() : null });
  }
  if (action === 'send' && req.method === 'POST') {
    const entry = await runQuarterly({ db });
    return res.status(entry.ok ? 200 : 500).json(entry);
  }
  return res.status(400).json({ error: 'Missing or invalid action parameter.' });
});

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const header = String(req.headers?.authorization || '');
  if (secret && header === `Bearer ${secret}`) {
    const entry = await runQuarterly({ db: adminDb(), fromCron: true });
    return res.status(entry.ok ? 200 : 500).json(entry);
  }
  return authed(req, res);
}
