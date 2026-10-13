// Vercel Cron entry point. Runs once a day (see vercel.json `crons`) and,
// for every user with data, writes a full JSON snapshot of their
// Firestore data to a private Google Cloud Storage bucket, prunes to the
// last 30, and emails a summary (counts only — no raw data leaves
// Firestore except into the bucket). If a count dropped sharply versus
// the previous run, the email is flagged as an urgent anomaly alert.
//
// Protected by CRON_SECRET exactly like pe-opps-scheduler: Vercel attaches
// `Authorization: Bearer <CRON_SECRET>`; a `?secret=` query param also
// works for a manual trigger.
//
// One user per invocation. The cron's own call lists the users and calls
// this endpoint again with `?uid=` for each, so every user gets the
// function's full maxDuration. It used to walk every user inside the one
// call, and once the data grew the run was killed at the time limit before
// it reached some users: their nightly backups stopped (for 83 days, in
// one case) with no error recorded anywhere, because a killed function
// never reaches its catch. Each run is also logged to backupCron/latest,
// so the backup-health banner can tell "the cron didn't fire" from "it ran
// and failed for you".
//
// Required env:
//   FIREBASE_SERVICE_ACCOUNT_KEY  — already set (Firestore admin)
//   GOOGLE_SERVICE_ACCOUNT_KEY    — already set (GCS, via JWT)
//   GMAIL_USER / GMAIL_APP_PASSWORD — already set (summary email)
//   BACKUP_GCS_BUCKET             — NEW: a GCS bucket in the same project
//                                   the service account can write to
// Optional env:
//   BACKUP_NOTIFY_EMAIL — send every summary here instead of each user's
//                         own email (handy for a single-operator setup)

import { adminDb, adminAuth } from './_lib/firebaseAdmin.js';
import { collectUserBackup, detectAnomalies } from './_lib/dataBackup.js';
import { uploadJsonToGcs, listBackupObjects, deleteGcsObject } from './_lib/gcs.js';
import { sendEmail } from './_lib/mailer.js';
import { selfBaseUrl, selfCallHeaders, readChildAnswer } from './_lib/backupFanout.js';

const RETAIN = 30;

function esc(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function summaryHtml({ fileName, summary, alerts, prevCounts }) {
  const rows = Object.keys(summary.counts).map(k => {
    const cur = summary.counts[k];
    const prev = prevCounts ? prevCounts[k] : undefined;
    const delta = prev != null ? cur - prev : null;
    const deltaStr = delta == null ? '-' : (delta > 0 ? `+${delta}` : String(delta));
    const color = delta != null && delta < 0 ? '#b91c1c' : '#334155';
    return `<tr>
      <td style="padding:4px 10px;border-bottom:1px solid #eee">${esc(k)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right">${esc(cur)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right;color:${color}">${esc(deltaStr)}</td>
    </tr>`;
  }).join('');

  const alertBlock = alerts.length ? `
    <div style="background:#fdecea;border:1px solid #f5c2c0;color:#8a1c12;border-radius:6px;padding:12px 14px;margin:0 0 16px">
      <strong>⚠ Possible data loss: review before trusting this backup.</strong>
      <ul style="margin:8px 0 0;padding-left:18px">
        ${alerts.map(a => `<li>${esc(a.field)} dropped ${a.dropPct}% (${a.prev} → ${a.cur})</li>`).join('')}
      </ul>
    </div>` : '';

  const errorBlock = summary.errors.length ? `
    <p style="color:#b45309;font-size:12px">Sections that failed to back up: ${summary.errors.map(esc).join('; ')}</p>` : '';

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#334155">
      <h2 style="color:#009530;margin:0 0 8px">Daily backup ${alerts.length ? '⚠' : '✓'}</h2>
      ${alertBlock}
      <p style="font-size:13px;margin:0 0 4px">Saved to cloud storage as <strong>${esc(fileName)}</strong> (last ${RETAIN} kept).</p>
      <table style="border-collapse:collapse;font-size:13px;margin:12px 0">
        <thead><tr>
          <th style="padding:4px 10px;text-align:left;border-bottom:2px solid #ddd">Dataset</th>
          <th style="padding:4px 10px;text-align:right;border-bottom:2px solid #ddd">Count</th>
          <th style="padding:4px 10px;text-align:right;border-bottom:2px solid #ddd">vs yesterday</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="3" style="padding:8px 10px">No data captured</td></tr>'}</tbody>
      </table>
      <p style="font-size:12px;color:#64748b">Captured: ${summary.captured.map(esc).join(', ') || 'none'}.</p>
      ${errorBlock}
      <p style="color:#8896A6;font-size:11px;margin-top:20px">Sent automatically from Prospect Tracker. Restore from the in-app "Restore from backup" picker, or download the JSON from cloud storage.</p>
    </div>`;
}

// How long the fan-out waits on each user's call. Under the function's
// own 300s, so the parent can still write its log; a child it stops
// waiting for keeps running in its own invocation regardless.
const CHILD_WAIT_MS = 280000;

// Leave the parent this long after the child calls to back up, in-process,
// any user whose call never reached the backup function.
const FALLBACK_BUDGET_MS = 240000;

// The cron's own call: list the users and hand each to its own invocation.
async function fanOut(req, res, db) {
  const startedAt = new Date().toISOString();
  const log = db.collection('backupCron').doc('latest');
  await log.set({ startedAt, finishedAt: null, users: null, results: null }).catch(() => {});

  let userDocs;
  try { userDocs = (await db.collection('users').get()).docs; }
  catch (err) {
    const error = `Failed to list users: ${String(err.message || err)}`;
    await log.set({ finishedAt: new Date().toISOString(), error }, { merge: true }).catch(() => {});
    return res.status(500).json({ error });
  }

  // The production domain rather than whichever host the cron used, no
  // redirects followed, and the protection bypass when the project has one:
  // a call deployment protection turns away must fail, not read as "ok".
  const base = selfBaseUrl({ env: process.env, headers: req.headers });
  const headers = selfCallHeaders(process.env);
  const started = Date.now();
  const results = await Promise.all(userDocs.map(async (u) => {
    const uid = u.id;
    try {
      const r = await fetch(`${base}/api/daily-backup?uid=${encodeURIComponent(uid)}`, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(CHILD_WAIT_MS),
      });
      const text = await r.text().catch(() => '');
      return readChildAnswer(uid, { status: r.status, location: r.headers.get('location') || '', text });
    } catch (err) {
      // A timeout means the child is still running in its own invocation;
      // it is not retried here.
      return { uid, status: 'error', reachedFunction: true, error: String(err?.message || err).slice(0, 300) };
    }
  }));

  // Anyone whose call never reached the function is backed up here, one at
  // a time, while there is time left. Slower than a call each, but a backup
  // that happens beats a log that says it did.
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (r.status !== 'error' || r.reachedFunction) continue;
    if (Date.now() - started > FALLBACK_BUDGET_MS) break;
    const direct = await backupOneUser(db, process.env.BACKUP_GCS_BUCKET, r.uid);
    results[i] = { ...direct, via: 'in-process', selfCallError: r.error };
  }

  await log.set({ finishedAt: new Date().toISOString(), users: userDocs.length, results }, { merge: true }).catch(() => {});
  return res.status(200).json({ ran: results.length, results, startedAt, at: new Date().toISOString() });
}

// One user's nightly backup: snapshot, upload, prune, compare, email.
async function backupOneUser(db, bucket, uid) {
  const date = new Date().toISOString().slice(0, 10);
  let email = null;
  try { email = (await db.collection('users').doc(uid).get()).data()?.email || null; } catch { /* fall through */ }
  if (!email) {
    try { email = (await adminAuth().getUser(uid)).email || null; } catch { /* no auth record */ }
  }

  // Marked before the slow part, so a run killed mid-backup still leaves
  // a trace the banner can read.
  await db.collection('backupRuns').doc(uid).set({
    lastAttemptAt: new Date().toISOString(),
  }, { merge: true }).catch(() => {});

  try {
    const { backup, summary } = await collectUserBackup(db, uid, email);

    // Skip users with nothing to protect.
    const totalCaptured = summary.captured.length;
    if (totalCaptured === 0) return { uid, status: 'skipped-empty' };

    const fileName = `prospect-tracker-backup-${uid}-${date}.json`;
    await uploadJsonToGcs({ bucket, name: fileName, content: JSON.stringify(backup) });

    // Retention: keep the newest RETAIN, delete the rest. Best-effort.
    try {
      const files = await listBackupObjects({ bucket, prefix: `prospect-tracker-backup-${uid}-` });
      for (const f of files.slice(RETAIN)) await deleteGcsObject({ bucket, name: f.name });
    } catch (e) { console.warn('backup retention prune failed', e); }

    // Anomaly check vs the previous run.
    let prevCounts = null;
    try {
      const prev = await db.collection('backupRuns').doc(uid).get();
      if (prev.exists) prevCounts = prev.data()?.counts || null;
    } catch { /* first run */ }
    const alerts = detectAnomalies(prevCounts, summary.counts);

    // Email the summary (best-effort — the bucket copy is the real save).
    const to = process.env.BACKUP_NOTIFY_EMAIL || email;
    let emailed = false;
    if (to) {
      try {
        await sendEmail({
          to,
          subject: `${alerts.length ? '⚠ ' : ''}Prospect Tracker daily backup: ${date}`,
          html: summaryHtml({ fileName, summary, alerts, prevCounts }),
        });
        emailed = true;
      } catch (e) { console.warn('backup summary email failed', e); }
    }

    await db.collection('backupRuns').doc(uid).set({
      counts: summary.counts,
      captured: summary.captured,
      errors: summary.errors,
      generatedAt: summary.generatedAt,
      lastFile: fileName,
      lastStatus: 'ok',
      lastError: null,
      alerts,
      emailed,
    }, { merge: true });

    return { uid, status: 'ok', counts: summary.counts, alerts, emailed };
  } catch (err) {
    await db.collection('backupRuns').doc(uid).set({
      lastStatus: 'error',
      lastError: String(err.message || err).slice(0, 500),
      generatedAt: new Date().toISOString(),
    }, { merge: true }).catch(() => {});
    return { uid, status: 'error', error: String(err.message || err) };
  }
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.query?.secret || '');
    if (token !== secret) return res.status(401).json({ error: 'Unauthorized' });
  }

  const bucket = process.env.BACKUP_GCS_BUCKET;
  if (!bucket) return res.status(500).json({ error: 'BACKUP_GCS_BUCKET not configured' });

  let db;
  try { db = adminDb(); }
  catch (err) { return res.status(500).json({ error: String(err.message || err) }); }

  const uid = String(req.query?.uid || '').trim();
  if (!uid) return fanOut(req, res, db);

  const result = await backupOneUser(db, bucket, uid);
  return res.status(result.status === 'error' ? 500 : 200).json(result);
}
