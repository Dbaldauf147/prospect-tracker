// On-demand backup for the signed-in user — the in-app "Back up to
// Drive now" button calls this. Unlike daily-backup (a CRON_SECRET cron
// that walks every user), this is authenticated per-request via the
// caller's Firebase ID token and backs up only that user. Handy to fire
// right before a risky edit so there's a fresh off-site copy.

import { withAuth } from './_lib/http.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { collectUserBackup } from './_lib/dataBackup.js';
import { uploadJsonToGcs, listBackupObjects, deleteGcsObject } from './_lib/gcs.js';

const RETAIN = 30;

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const bucket = process.env.BACKUP_GCS_BUCKET;
  if (!bucket) return res.status(500).json({ error: 'BACKUP_GCS_BUCKET not configured' });

  let db;
  try { db = adminDb(); }
  catch (err) { return res.status(500).json({ error: String(err.message || err) }); }

  try {
    const { backup, summary } = await collectUserBackup(db, auth.uid, auth.email);
    if (summary.captured.length === 0) {
      return res.status(200).json({ status: 'empty', summary });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `prospect-tracker-backup-${auth.uid}-manual-${stamp}.json`;
    await uploadJsonToGcs({ bucket, name: fileName, content: JSON.stringify(backup) });

    // Share the same 30-deep ring as the daily backups (prefix match).
    try {
      const files = await listBackupObjects({ bucket, prefix: `prospect-tracker-backup-${auth.uid}-` });
      for (const f of files.slice(RETAIN)) await deleteGcsObject({ bucket, name: f.name });
    } catch (e) { console.warn('backup-now retention prune failed', e); }

    // Record the run so the daily anomaly check has the latest baseline.
    await db.collection('backupRuns').doc(auth.uid).set({
      counts: summary.counts,
      captured: summary.captured,
      errors: summary.errors,
      generatedAt: summary.generatedAt,
      lastFile: fileName,
      lastStatus: 'ok-manual',
    }, { merge: true }).catch(() => {});

    return res.status(200).json({
      status: 'ok',
      file: fileName,
      counts: summary.counts,
      captured: summary.captured,
      errors: summary.errors,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
