// The month-end Quoted Projections capture, run on the server.
//
// The YOY page captures the live month's figures while it is open, and a
// finished month keeps the reading taken on its last day. If nobody had the
// page open on that day the month was never captured, and the chart fell
// back to rebuilding it from the next month's opps, which early in a month
// is just today's pipeline under last month's label. This takes that last-day
// reading for every user from their Firestore data, so it no longer depends
// on a browser being open.
//
// It writes the same entry the page's auto-capture writes (`_auto` with a
// `_capturedAt` on the month's last UTC day) into the same mirrored store,
// stamped newer than any browser's copy, so every browser adopts it on its
// next sync and a stale open tab can't push over it (utils/localMirrorSync
// refuses a push based on an older cloud copy). A month typed in through
// "Edit values" is left alone.

import { readChunkedJson, loadOpps2, loadMirror, MIRROR } from './firestoreChunks.js';
import { writeMirrorDoc } from './mirrorRecover.js';
import { liveQuotedFigures, roundQuotedFigures, withMonthEndCapture, utcMonthKey } from '../../src/utils/quotedLiveSnapshot.js';

export const QUOTED_MIRROR_ID = 'yoy-quoted-projections';

const mirrorRef = (db, uid, id) => db.collection('userSettings').doc(uid).collection('localMirrors').doc(id);

/**
 * Capture `monthKey` (default: the current UTC month) for one user.
 * Returns { uid, status, monthKey, values? } where status is one of
 * 'captured', 'dry-run', 'no-table' (never used the YOY chart), 'no-opps',
 * 'manual' (the month holds a typed-in value), or 'unchanged'.
 */
export async function captureQuotedMonthEnd(db, uid, { now = Date.now(), dryRun = false } = {}) {
  const monthKey = utcMonthKey(now);
  const ref = mirrorRef(db, uid, QUOTED_MIRROR_ID);
  const json = await readChunkedJson(ref, { field: 's' });
  if (!json) return { uid, monthKey, status: 'no-table' };
  let table;
  try { table = JSON.parse(json); } catch { return { uid, monthKey, status: 'no-table' }; }
  if (!table || typeof table !== 'object' || Array.isArray(table)) return { uid, monthKey, status: 'no-table' };

  const opps = await loadOpps2(db, uid);
  const records = Array.isArray(opps?.records) ? opps.records : [];
  const bfo = await loadMirror(db, uid, MIRROR.bfo, null);
  const values = roundQuotedFigures(liveQuotedFigures(records, bfo));
  if (!values) return { uid, monthKey, status: 'no-opps' };

  const next = withMonthEndCapture(table, monthKey, values, new Date(now).toISOString());
  if (!next) return { uid, monthKey, status: 'manual', values };
  const nextJson = JSON.stringify(next);
  if (nextJson === json) return { uid, monthKey, status: 'unchanged', values };
  if (dryRun) return { uid, monthKey, status: 'dry-run', values };
  await writeMirrorDoc(db, ref, nextJson, Date.now());
  return { uid, monthKey, status: 'captured', values };
}

// Every user with an Opps 2 dataset.
export async function quotedCaptureUserIds(db) {
  const refs = await db.collection('opps2Data').listDocuments();
  return refs.map(r => r.id);
}
