// Return the contents of one of the signed-in user's Drive backups for
// the in-app "Restore from Drive" picker. Ownership is enforced by
// checking the file's name carries the caller's uid before any content
// is read — so one user can never fetch another's backup by id.
//
// Query: ?id=<driveFileId>&part=<collectionName?>
//   part omitted  → the whole backup object
//   part=opps2Data → just that collection (smaller payload; what the
//                    Opps 2 restore picker uses)

import { withAuth } from './_lib/http.js';
import { getDriveFileMeta, downloadDriveFile } from './_lib/googleDrive.js';

async function handler(req, res, auth) {
  const folderId = process.env.BACKUP_DRIVE_FOLDER_ID;
  if (!folderId) return res.status(500).json({ error: 'BACKUP_DRIVE_FOLDER_ID not configured' });

  const id = String(req.query?.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing file id' });
  const part = String(req.query?.part || '').trim();

  try {
    const meta = await getDriveFileMeta(id);
    if (!String(meta?.name || '').startsWith(`prospect-tracker-backup-${auth.uid}-`)) {
      return res.status(403).json({ error: 'Not your backup' });
    }
    const text = await downloadDriveFile(id);
    let backup;
    try { backup = JSON.parse(text); }
    catch { return res.status(500).json({ error: 'Backup file is not valid JSON' }); }

    if (part) {
      const value = backup?.collections ? backup.collections[part] : undefined;
      return res.status(200).json({ name: meta.name, generatedAt: backup?.generatedAt || null, part, value: value ?? null });
    }
    return res.status(200).json({ name: meta.name, generatedAt: backup?.generatedAt || null, backup });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
