// Vercel Cron entry point. Runs hourly (see vercel.json `crons`) and
// sends any PE Opps email schedules that are due. Each schedule lives in
// the `peOppsEmailSchedules` Firestore collection and is owned by a user;
// the file is rebuilt from that user's `opps2Data` doc so the cron works
// with no browser open.
//
// Protected by CRON_SECRET: when set, Vercel automatically attaches
// `Authorization: Bearer <CRON_SECRET>` to cron invocations. A matching
// `?secret=` query param is also accepted for manual triggering.

import { adminDb } from './_lib/firebaseAdmin.js';
import { loadPeOpps, buildPeOppsWorkbook, sendPeOppsEmail, peOppsFilename } from './_lib/peOpps.js';
import { computeNextRun } from './_lib/peOppsSchedule.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.query?.secret || '');
    if (token !== secret) return res.status(401).json({ error: 'Unauthorized' });
  }

  let db;
  try { db = adminDb(); }
  catch (err) { return res.status(500).json({ error: String(err.message || err) }); }

  const now = Date.now();
  const results = [];

  let snap;
  try {
    snap = await db.collection('peOppsEmailSchedules').where('enabled', '==', true).get();
  } catch (err) {
    return res.status(500).json({ error: `Failed to read schedules: ${String(err.message || err)}` });
  }

  for (const docSnap of snap.docs) {
    const s = { id: docSnap.id, ...docSnap.data() };
    const due = !s.nextRunAt || Number(s.nextRunAt) <= now;
    if (!due) continue;
    if (!s.ownerUid || !Array.isArray(s.recipients) || s.recipients.length === 0) {
      await docSnap.ref.update({
        lastStatus: 'error',
        lastError: 'Schedule missing owner or recipients',
        nextRunAt: computeNextRun(s, now),
      }).catch(() => {});
      results.push({ id: s.id, status: 'error', error: 'missing owner/recipients' });
      continue;
    }

    try {
      const records = await loadPeOpps(db, s.ownerUid);
      if (records.length === 0 && s.skipWhenEmpty) {
        await docSnap.ref.update({
          lastStatus: 'skipped-empty',
          lastError: null,
          nextRunAt: computeNextRun(s, now),
        });
        results.push({ id: s.id, status: 'skipped-empty' });
        continue;
      }
      const buffer = await buildPeOppsWorkbook(records, s.columns);
      await sendPeOppsEmail({
        to: s.recipients,
        subject: s.subject,
        message: s.message,
        buffer,
        filename: peOppsFilename(),
        replyTo: s.ownerEmail,
      });
      await docSnap.ref.update({
        lastSentAt: now,
        lastStatus: 'sent',
        lastError: null,
        lastOppCount: records.length,
        lastRecipientCount: s.recipients.length,
        nextRunAt: computeNextRun(s, now),
      });
      results.push({ id: s.id, status: 'sent', opps: records.length });
    } catch (err) {
      await docSnap.ref.update({
        lastStatus: 'error',
        lastError: String(err.message || err).slice(0, 500),
        nextRunAt: computeNextRun(s, now),
      }).catch(() => {});
      results.push({ id: s.id, status: 'error', error: String(err.message || err) });
    }
  }

  return res.status(200).json({ ran: results.length, results, at: new Date(now).toISOString() });
}
