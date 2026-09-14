// Vercel Cron entry point. Runs hourly (see vercel.json `crons`) and sends
// any Weekly Report email schedules that are due. Each schedule lives in
// the `weeklyReportEmailSchedules` Firestore collection and is owned by a
// user; the email is built from that user's `weeklyReportSnapshots` doc,
// which the Weekly Report tab publishes on every visit. Mirrors
// api/new-opps-scheduler.js.
//
// The report is rebuilt from Firestore and HubSpot at send time (see
// _lib/weeklyReportBuild.js), so a schedule no longer depends on the owner
// having opened the tab recently. The published snapshot is still the
// fallback: when the rebuild comes back with no figures at all — an empty
// or unreadable Firestore side — the last thing the tab published is a
// better report than a blank one. A schedule with neither is recorded as
// `skipped-no-snapshot` rather than mailed empty.
//
// Protected by CRON_SECRET: when set, Vercel automatically attaches
// `Authorization: Bearer <CRON_SECRET>` to cron invocations. A matching
// `?secret=` query param is also accepted for manual triggering.

import { adminDb } from './_lib/firebaseAdmin.js';
import { sendWeeklyReportEmail, freshnessNote } from './_lib/weeklyReportEmail.js';
import { buildWeeklyReport } from './_lib/weeklyReportBuild.js';
import { buildSnapshotDoc } from './_lib/weeklyReportSnapshot.js';
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
      // Rebuild first. A built report covers the period that has actually
      // finished and is stamped with the moment it was built, so it never
      // arrives carrying the staleness banner.
      let snapshot = null;
      let source = 'rebuilt';
      let buildErrors = [];
      try {
        const built = await buildWeeklyReport(db, s.ownerUid, {
          now,
          timeZone: s.timeZone || '',
          scope: s.frequency === 'daily' ? 'day' : 'week',
        });
        buildErrors = built.errors || [];
        if (built.usable) {
          snapshot = buildSnapshotDoc(built.payload, { uid: s.ownerUid, email: s.ownerEmail });
        }
      } catch (err) {
        buildErrors = [String(err?.message || err).slice(0, 200)];
      }
      if (buildErrors.length) {
        console.warn(`weekly-report ${s.id}: rebuild issues — ${buildErrors.join('; ')}`);
      }

      if (!snapshot) {
        const shot = await db.collection('weeklyReportSnapshots').doc(s.ownerUid).get();
        if (!shot.exists) {
          await docSnap.ref.update({
            lastStatus: 'skipped-no-snapshot',
            lastError: buildErrors.length
              ? `Nothing to rebuild from, and no saved snapshot (${buildErrors[0]})`
              : 'No Weekly Report snapshot saved yet',
            nextRunAt: computeNextRun(s, now),
          });
          results.push({ id: s.id, status: 'skipped-no-snapshot' });
          continue;
        }
        snapshot = shot.data();
        source = 'snapshot';
      }
      // A snapshot older than the period it reports still goes out: the
      // report is a standing Monday habit, and silence would read as "no
      // news" rather than as "the tab hasn't been open in a fortnight".
      // It goes out labelled, though — a banner at the top of the mail, a
      // tag on the subject, and this status, so the schedule list shows it
      // too rather than a run of ordinary "sent".
      const fresh = freshnessNote(snapshot, now);
      await sendWeeklyReportEmail({
        to: s.recipients,
        subject: s.subject,
        message: s.message,
        snapshot,
        replyTo: s.ownerEmail,
      });
      const status = fresh.stale ? 'sent-stale' : 'sent';
      await docSnap.ref.update({
        lastSentAt: now,
        lastStatus: status,
        lastError: fresh.stale ? fresh.headline : null,
        lastSnapshotAt: snapshot.capturedAt || null,
        lastSnapshotStale: !!fresh.stale,
        // 'rebuilt' = computed at send time; 'snapshot' = the tab's last
        // publish stood in because the rebuild found nothing.
        lastSource: source,
        lastRecipientCount: s.recipients.length,
        nextRunAt: computeNextRun(s, now),
      });
      results.push({ id: s.id, status, source, snapshotAt: snapshot.capturedAt || null });
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
