// List the signed-in user's Drive backup files (newest first) for the
// in-app "Restore from Drive" picker. Authenticated per-request; only
// ever returns files whose name carries the caller's own uid.

import { withAuth } from './_lib/http.js';
import { listBackupFiles } from './_lib/googleDrive.js';

async function handler(req, res, auth) {
  const folderId = process.env.BACKUP_DRIVE_FOLDER_ID;
  if (!folderId) return res.status(500).json({ error: 'BACKUP_DRIVE_FOLDER_ID not configured' });
  try {
    const files = await listBackupFiles({ folderId, prefix: `prospect-tracker-backup-${auth.uid}-` });
    return res.status(200).json({
      files: files.map(f => ({ id: f.id, name: f.name, createdTime: f.createdTime })),
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
