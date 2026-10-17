// Recover one of the signed-in user's mirrored browser stores from Firestore
// point-in-time recovery, filing each copy found in the last 7 days as an
// earlier version (see _lib/mirrorRecover.js). Used by Commissions >
// Earlier versions > "Look for older copies".
//
// POST { key }  ->  { pitr, found: [{ asOf, rows, bytes }], added, checked }
// Only ever the caller's own data: the uid comes from their ID token.

import { Timestamp } from 'firebase-admin/firestore';
import { withAuth } from './_lib/http.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { recoverMirror } from './_lib/mirrorRecover.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = String(req.body?.key || '').trim();
  // A mirror document id: no slashes, and not a version or index itself.
  if (!key || key.includes('/') || /__v\d+$|__versions$/.test(key)) return res.status(400).json({ error: 'Bad key' });
  const result = await recoverMirror(adminDb(), auth.uid, key, { toTimestamp: (ms) => Timestamp.fromMillis(ms) });
  return res.status(200).json(result);
}

export default withAuth(handler);
