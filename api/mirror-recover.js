// Recover one of the signed-in user's mirrored browser stores from Firestore
// point-in-time recovery, filing each copy found in the last 7 days as an
// earlier version (see _lib/mirrorRecover.js). Used by Commissions >
// Earlier versions > "Look for older copies".
//
// POST { key }  ->  { pitr, found: [{ asOf, rows, bytes }], added, checked }
//
// POST { key, fromDatabase }  ->  { found, added }
//   Copy the key out of another database in this project, one restored from
//   a Firestore scheduled backup (backups restore into a new database, never
//   over the live one), and file it as an earlier version.
//
// Only ever the caller's own data: the uid comes from their ID token.

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { withAuth } from './_lib/http.js';
import { adminApp, adminDb } from './_lib/firebaseAdmin.js';
import { copyMirrorFromDatabase, recoverMirror } from './_lib/mirrorRecover.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = String(req.body?.key || '').trim();
  // A mirror document id: no slashes, and not a version or index itself.
  if (!key || key.includes('/') || /__v\d+$|__versions$/.test(key)) return res.status(400).json({ error: 'Bad key' });
  const fromDatabase = String(req.body?.fromDatabase || '').trim();
  if (fromDatabase) {
    // A Firestore database id: lowercase letters, digits and hyphens.
    if (!/^[a-z][a-z0-9-]{3,62}$/.test(fromDatabase)) return res.status(400).json({ error: 'That is not a valid database ID (lowercase letters, numbers and hyphens).' });
    try {
      const result = await copyMirrorFromDatabase(getFirestore(adminApp(), fromDatabase), adminDb(), auth.uid, key);
      return res.status(200).json(result);
    } catch (err) {
      if (err?.code === 5 || /NOT_FOUND/i.test(String(err?.code || err?.message || ''))) {
        return res.status(404).json({ error: `No database named "${fromDatabase}" in this project yet. If you just started the restore, it can take a while to finish.` });
      }
      throw err;
    }
  }
  const result = await recoverMirror(adminDb(), auth.uid, key, { toTimestamp: (ms) => Timestamp.fromMillis(ms) });
  return res.status(200).json(result);
}

export default withAuth(handler);
