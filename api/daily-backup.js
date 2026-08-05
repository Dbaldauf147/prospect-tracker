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

  let userDocs;
  try { userDocs = (await db.collection('users').get()).docs; }
  catch (err) { return res.status(500).json({ error: `Failed to list users: ${String(err.message || err)}` }); }

  const date = new Date().toISOString().slice(0, 10);
  const results = [];

  for (const u of userDocs) {
    const uid = u.id;
    let email = u.data()?.email || null;
    if (!email) {
      try { email = (await adminAuth().getUser(uid)).email || null; } catch { /* no auth record */ }
    }

    try {
      const { backup, summary } = await collectUserBackup(db, uid, email);

      // Skip users with nothing to protect.
      const totalCaptured = summary.captured.length;
      if (totalCaptured === 0) { results.push({ uid, status: 'skipped-empty' }); continue; }

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
        alerts,
        emailed,
      }, { merge: true });

      results.push({ uid, status: 'ok', counts: summary.counts, alerts, emailed });
    } catch (err) {
      await db.collection('backupRuns').doc(uid).set({
        lastStatus: 'error',
        lastError: String(err.message || err).slice(0, 500),
        generatedAt: new Date().toISOString(),
      }, { merge: true }).catch(() => {});
      results.push({ uid, status: 'error', error: String(err.message || err) });
    }
  }

  return res.status(200).json({ ran: results.length, results, at: new Date().toISOString() });
}
