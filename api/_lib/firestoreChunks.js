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
};
