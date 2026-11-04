// Vercel Cron entry point. Runs late on days 28-31 (see vercel.json `crons`)
// and, on the last day of the month, saves each user's Quoted Projections
// figures as that month's month-end reading, so a month no longer depends on
// someone having the YOY page open on its last day (see
// api/_lib/quotedMonthEnd.js).
//
// Protected by CRON_SECRET like the other crons: Vercel attaches
// `Authorization: Bearer <CRON_SECRET>`; a `?secret=` query param works for a
// manual run. `&dry=1` reports what would be written without writing, and
// `&force=1` runs on a day that isn't the month's last (the capture it
// writes then is a mid-month reading, which the page treats as such).

import { adminDb } from './_lib/firebaseAdmin.js';
import { captureQuotedMonthEnd, quotedCaptureUserIds } from './_lib/quotedMonthEnd.js';
import { isLastDayOfMonthUTC } from '../src/utils/quotedLiveSnapshot.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.query?.secret || '');
    if (token !== secret) return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = Date.now();
  const dryRun = String(req.query?.dry || '') === '1';
  const force = String(req.query?.force || '') === '1';
  if (!force && !isLastDayOfMonthUTC(now)) {
    return res.status(200).json({ ok: true, skipped: 'not the last day of the month (UTC)' });
  }

  let db;
  try { db = adminDb(); }
  catch (err) { return res.status(500).json({ error: String(err.message || err) }); }

  let uids;
  try { uids = await quotedCaptureUserIds(db); }
  catch (err) { return res.status(500).json({ error: `Failed to list users: ${String(err.message || err)}` }); }

  const results = [];
  for (const uid of uids) {
    try {
      results.push(await captureQuotedMonthEnd(db, uid, { now, dryRun }));
    } catch (err) {
      results.push({ uid, status: 'error', error: String(err.message || err) });
    }
  }
  const failed = results.some(r => r.status === 'error');
  return res.status(failed ? 500 : 200).json({ ok: !failed, dryRun, results });
}
