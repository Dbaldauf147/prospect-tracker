// Vercel Cron entry point. Runs hourly (see vercel.json `crons`) and sends
// any Weekly Report email schedules that are due. Each schedule lives in
// the `weeklyReportEmailSchedules` Firestore collection and is owned by a
// user; the email is built from that user's `weeklyReportSnapshots` doc,
// which the Weekly Report tab publishes on every visit. Mirrors
// api/new-opps-scheduler.js.
//
// Unlike the New Opps digest, the report cannot be rebuilt from Firestore
// on demand — its numbers come from browser-only caches — so a schedule
// whose owner has never opened the tab has nothing to send. That is
// recorded as `skipped-no-snapshot` rather than mailed as an empty report.
//
// Protected by CRON_SECRET: when set, Vercel automatically attaches
// `Authorization: Bearer <CRON_SECRET>` to cron invocations. A matching
// `?secret=` query param is also accepted for manual triggering.

import { adminDb } from './_lib/firebaseAdmin.js';
import { sendWeeklyReportEmail } from './_lib/weeklyReportEmail.js';
import { computeNextRunZoned as computeNextRun } from './_lib/weeklyReportSchedule.js';

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
    snap = await db.collection('weeklyReportEmailSchedules').where('enabled', '==', true).get();
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
      const shot = await db.collection('weeklyReportSnapshots').doc(s.ownerUid).get();
      if (!shot.exists) {
        await docSnap.ref.update({
          lastStatus: 'skipped-no-snapshot',
          lastError: 'No Weekly Report snapshot saved yet',
          nextRunAt: computeNextRun(s, now),
        });
        results.push({ id: s.id, status: 'skipped-no-snapshot' });
        continue;
      }
      const snapshot = shot.data();
      await sendWeeklyReportEmail({
        to: s.recipients,
        subject: s.subject,
        message: s.message,
        snapshot,
        replyTo: s.ownerEmail,
      });
      await docSnap.ref.update({
        lastSentAt: now,
        lastStatus: 'sent',
        lastError: null,
        lastSnapshotAt: snapshot.capturedAt || null,
        lastRecipientCount: s.recipients.length,
        nextRunAt: computeNextRun(s, now),
      });
      results.push({ id: s.id, status: 'sent', snapshotAt: snapshot.capturedAt || null });
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
