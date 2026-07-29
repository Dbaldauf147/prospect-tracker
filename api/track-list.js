// Authenticated fallback reader for the Email Tracking dashboard.
//
// The dashboard normally reads the `emailTracking` collection directly
// from the browser via a realtime Firestore listener (see
// EmailTrackingView + the emailTracking rule in firestore.rules). That
// client-read path only works once that read rule has actually been
// DEPLOYED to the Firestore project — `firebase deploy --only
// firestore:rules`. If the code shipped but the rules were never
// redeployed, the realtime query is rejected with "Missing or
// insufficient permissions" and the dashboard looks broken.
//
// This endpoint is the resilient fallback: it reads the same per-user
// records with the Admin SDK, which bypasses security rules, so the
// dashboard still populates when the client-read rule hasn't been
// deployed yet. It is strictly owner-scoped — it only ever returns the
// authenticated caller's own tracking rows (uid == auth.uid).
//
// GET /api/track-list  ->  { items: [ ...trackingDocs ] }

import { withAuth } from './_lib/http.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { TRACKING_COLLECTION } from './_lib/tracking.js';

// Convert Firestore Admin Timestamps (including those nested inside the
// opens/clicks arrays) into the { _seconds, _nanoseconds } shape the
// client's toDate() already understands, so JSON serialization is
// lossless and independent of the firebase-admin version's internals.
function serialize(value) {
  if (value == null) return value;
  if (typeof value.toDate === 'function' && typeof value.seconds === 'number') {
    return { _seconds: value.seconds, _nanoseconds: value.nanoseconds || 0 };
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

async function handler(req, res, auth) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = adminDb();
    // Single-field equality filter — no composite index required. Sort
    // client-side (same as the realtime path) to keep it index-free.
    const snap = await db
      .collection(TRACKING_COLLECTION)
      .where('uid', '==', auth.uid)
      .get();
    const items = snap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) }));
    return res.status(200).json({ items });
  } catch (err) {
    console.error('track-list: failed to load tracking:', err?.message || err);
    return res.status(500).json({ error: 'Failed to load tracking data' });
  }
}

export default withAuth(handler);
