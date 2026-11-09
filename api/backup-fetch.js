// Return the contents of one of the signed-in user's cloud-storage
// backups for the in-app "Restore from backup" picker. Ownership is
// enforced by checking the object name carries the caller's uid before
// any content is read — so one user can never fetch another's backup.
//
// Query: ?name=<objectName>&part=<collectionName?>
//   part omitted  → the whole backup object
//   part=opps2Data → just that collection (smaller payload; what the
//                    Opps 2 restore picker uses)
//   part=membership&cdm=<name> → that night's My Accounts, worked out on
//                    the server with the page's own rule, plus a slim card
//                    per prospect (src/utils/backupMembership), for the All
//                    Missing History "who joined that day" popup

import { withAuth } from './_lib/http.js';
import { downloadGcsObject } from './_lib/gcs.js';
import { membershipFromBackup } from '../src/utils/backupMembership.js';

async function handler(req, res, auth) {
  const bucket = process.env.BACKUP_GCS_BUCKET;
  if (!bucket) return res.status(500).json({ error: 'BACKUP_GCS_BUCKET not configured' });

  const name = String(req.query?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Missing object name' });
  // Ownership check on the name itself — before fetching anything.
  if (!name.startsWith(`prospect-tracker-backup-${auth.uid}-`)) {
    return res.status(403).json({ error: 'Not your backup' });
  }
  const part = String(req.query?.part || '').trim();

  try {
    const text = await downloadGcsObject({ bucket, name });
    let backup;
    try { backup = JSON.parse(text); }
    catch { return res.status(500).json({ error: 'Backup file is not valid JSON' }); }

    if (part === 'membership') {
      return res.status(200).json({ name, generatedAt: backup?.generatedAt || null, part, value: membershipFromBackup(backup, String(req.query?.cdm || '').trim()) });
    }
    if (part) {
      const value = backup?.collections ? backup.collections[part] : undefined;
      return res.status(200).json({ name, generatedAt: backup?.generatedAt || null, part, value: value ?? null });
    }
    return res.status(200).json({ name, generatedAt: backup?.generatedAt || null, backup });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
