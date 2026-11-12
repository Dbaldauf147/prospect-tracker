// Reading the app's chunked Firestore documents from the server.
//
// Several of the browser's stores are too big for Firestore's ~1 MB
// per-document cap, so they are written as a `chunks` subcollection with
// the parent doc holding a `chunkCount`: opps2Data (utils/opps2Store) and
// every localStorage / IndexedDB mirror (utils/localMirrorSync). The two
// layouts differ only in the field each chunk keeps its slice under, so
// one reader with a `field` option covers both.
//
// Written once here because three server modules had already grown their
// own copy of the opps2 loop, and the next one to drift would read a
// short document as an empty one — which looks exactly like a user with
// no data.

import { withoutDuplicateRows } from '../../src/utils/targetDuplicates.js';

/**
 * Join a chunked document back into the JSON string it was written from.
 *
 * @param ref a firebase-admin DocumentReference
 * @param field which field each chunk doc keeps its slice under —
 *   'json' for opps2Data, 's' for the localMirrors documents
 * @returns the JSON string, or null when the document is missing or empty
 */
export async function readChunkedJson(ref, { field = 'json' } = {}) {
  const snap = await ref.get();
  if (!snap.exists) return null;
  const raw = snap.data() || {};
  const count = Number(raw.chunkCount);
  if (Number.isFinite(count) && count > 0) {
    const parts = new Array(count).fill('');
    const chunks = await ref.collection('chunks').get();
    chunks.forEach((d) => {
      const i = Number(d.id);
      if (Number.isInteger(i) && i >= 0 && i < parts.length) {
        parts[i] = String(d.data()?.[field] || '');
      }
    });
    const joined = parts.join('');
    return joined || null;
  }
  return typeof raw.json === 'string' && raw.json ? raw.json : null;
}

// The same, parsed. Returns `fallback` when the document is missing or the
// JSON won't parse — a caller that needs to tell those apart (the backup,
// which keeps unparseable text rather than discarding it) should use
// readChunkedJson directly.
export async function readChunkedValue(ref, { field = 'json', fallback = null } = {}) {
  const json = await readChunkedJson(ref, { field });
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

// ---- The app's own documents -------------------------------------------

// `opps2Data/{uid}` — the Opps 2 dataset, as `{ headers, records }`.
export async function loadOpps2(db, uid) {
  return readChunkedValue(db.collection('opps2Data').doc(uid), { field: 'json' });
}

// `targetAccounts/{uid}` — the Target Accounts workbook, as `{ sheets, ... }`.
// Written by utils/chunkedDoc (slices under `s`); a document from before
// that kept the JSON under `json`, and the oldest kept the workbook's own
// fields on the document, which is returned as is.
// Rows flagged as duplicates on the Target Accounts page are left out:
// every caller reads the list, none writes it back.
export async function loadTargetAccounts(db, uid) {
  const ref = db.collection('targetAccounts').doc(uid);
  const value = await readChunkedValue(ref, { field: 's' });
  if (value) return withoutDuplicateRows(value);
  const snap = await ref.get();
  const raw = snap.exists ? (snap.data() || {}) : null;
  return raw?.sheets ? withoutDuplicateRows(raw) : null;
}

// A localStorage / IndexedDB mirror. `id` is the document id
// utils/localMirrorSync writes under: the bare localStorage key, or
// `idb__<store>__<key>` for an IndexedDB record.
export async function loadMirror(db, uid, id, fallback = null) {
  const ref = db.collection('userSettings').doc(uid).collection('localMirrors').doc(id);
  return readChunkedValue(ref, { field: 's', fallback });
}

// The mirror ids the Weekly Report reads, spelled the way
// utils/localMirrorSync.dbMirrorId spells them.
export const MIRROR = {
  pipeline: 'idb__pipeline-dashboard__current',
  bfo: 'idb__bfo-activity__current',
  goals: 'idb__daily-success-goals__list',
  activityLog: 'weekly-activity-log',
  yoyOverrides: 'yoy-chart-overrides',
  // The Clients tab's "Don't Track" ticks, which the Progress tab takes
  // out of its coverage charts before plotting them.
  clientUntracked: 'clients-untracked-map',
  // My Accounts > All Missing History, the All Missing Steps total by day.
  missingHistory: 'company-data-missing-history',
};

// ---- Writing ----------------------------------------------------------

// Characters per chunk. A UTF-16 code unit is at most 3 bytes of UTF-8, so
// a chunk is at most ~600 KB, under Firestore's 1 MiB per-document cap
// whatever the text is.
const WRITE_CHUNK_CHARS = 200 * 1024;
// Chunks per commit: ten at ~600 KB stays well under the 11 MiB request cap.
const WRITE_CHUNKS_PER_BATCH = 10;

function splitChars(str, size) {
  const parts = [];
  let i = 0;
  while (i < str.length) {
    let end = Math.min(str.length, i + size);
    // Never split a surrogate pair: neither half survives UTF-8 alone.
    if (end < str.length) {
      const code = str.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    parts.push(str.slice(i, end));
    i = end;
  }
  return parts;
}

/**
 * Write `value` at `ref` in the layout src/utils/chunkedDoc.js reads: a
 * parent { ...meta, chunkCount, updatedAt, json } and, when the JSON is
 * too big for one document, a `chunks` subcollection with each slice under
 * `s`. For server jobs that update a store the browser owns.
 *
 * `value` must be plain JSON (what readChunkedValue hands back is).
 */
export async function writeChunkedValue(db, ref, value, { meta = {} } = {}) {
  const json = JSON.stringify(value);
  const updatedAt = Date.now();
  const prior = Number((await ref.get()).data()?.chunkCount) || 0;
  const drop = async (from, to) => {
    for (let start = from; start < to; start += 400) {
      const batch = db.batch();
      for (let i = start; i < Math.min(start + 400, to); i++) batch.delete(ref.collection('chunks').doc(String(i)));
      await batch.commit();
    }
  };

  if (Buffer.byteLength(json, 'utf8') <= 900 * 1024) {
    await ref.set({ ...meta, chunkCount: 0, updatedAt, json });
    await drop(0, prior);
    return;
  }
  const parts = splitChars(json, WRITE_CHUNK_CHARS);
  for (let start = 0; start < parts.length; start += WRITE_CHUNKS_PER_BATCH) {
    const batch = db.batch();
    for (let i = start; i < Math.min(start + WRITE_CHUNKS_PER_BATCH, parts.length); i++) {
      batch.set(ref.collection('chunks').doc(String(i)), { s: parts[i] });
    }
    await batch.commit();
  }
  // The parent lands last, so a reader never sees a chunkCount whose
  // chunks aren't all written yet.
  await ref.set({ ...meta, chunkCount: parts.length, updatedAt, json: '' });
  if (prior > parts.length) await drop(parts.length, prior);
}
