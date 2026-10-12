// Are the signed-in user's cloud backups working? Powers the warning banner
// the site shows when they aren't (see api/_lib/backupHealth.js for the
// checks and why they exist). Read-mostly: the only write is the tiny probe
// object, overwritten in place each time.
import { withAuth } from './_lib/http.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { listBackupObjects, uploadJsonToGcs, downloadGcsObject } from './_lib/gcs.js';
import { assessBackupHealth, fixLinks, probeObjectName, projectIdFromKey } from './_lib/backupHealth.js';

async function handler(req, res, auth) {
  const bucket = process.env.BACKUP_GCS_BUCKET;
  const links = fixLinks(projectIdFromKey(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), bucket);
  if (!bucket) {
    return res.status(200).json({ ...assessBackupHealth({ configured: false }), links });
  }

  let probeError = '';
  try {
    const stamp = new Date().toISOString();
    const name = probeObjectName(auth.uid);
    await uploadJsonToGcs({ bucket, name, content: JSON.stringify({ checkedAt: stamp }) });
    const back = JSON.parse(await downloadGcsObject({ bucket, name }));
    if (back?.checkedAt !== stamp) probeError = 'the test file read back did not match what was written';
  } catch (err) {
    probeError = String(err?.message || err);
  }

  let files = [];
  let listError = '';
  try {
    files = await listBackupObjects({ bucket, prefix: `prospect-tracker-backup-${auth.uid}-` });
  } catch (err) {
    listError = String(err?.message || err);
  }

  // The nightly job's own records, so a missing backup can say why. Best
  // effort: the verdict stands without them.
  let cron = null;
  let run = null;
  try {
    const db = adminDb();
    const [c, r] = await Promise.all([
      db.collection('backupCron').doc('latest').get(),
      db.collection('backupRuns').doc(auth.uid).get(),
    ]);
    cron = c.exists ? c.data() : null;
    run = r.exists ? { uid: auth.uid, ...r.data() } : null;
  } catch { /* leave them out */ }

  return res.status(200).json({ ...assessBackupHealth({ files, probeError, listError, cron, run }), links });
}

export default withAuth(handler);
