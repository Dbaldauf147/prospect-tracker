// List the signed-in user's cloud-storage backup files (newest first)
// for the in-app "Restore from backup" picker. Authenticated
// per-request; only ever returns files whose name carries the caller's
// own uid.

import { withAuth } from './_lib/http.js';
import { listBackupObjects } from './_lib/gcs.js';

async function handler(req, res, auth) {
  const bucket = process.env.BACKUP_GCS_BUCKET;
  if (!bucket) return res.status(500).json({ error: 'BACKUP_GCS_BUCKET not configured' });
  try {
    const files = await listBackupObjects({ bucket, prefix: `prospect-tracker-backup-${auth.uid}-` });
    return res.status(200).json({
      files: files.map(f => ({ name: f.name, createdTime: f.createdTime })),
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
