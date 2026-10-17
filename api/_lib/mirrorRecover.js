// Recovering a mirrored browser store (userSettings/{uid}/localMirrors/{id},
// written by utils/localMirrorSync) from Firestore point-in-time recovery.
//
// Written when the Commissions roster was lost: the cloud copy had been
// overwritten and no backup held it. If PITR is enabled on the database,
// Firestore keeps every document's history for 7 days and will serve a
// read "as of" any whole minute in that window. This reads the store hour
// by hour back through the window, keeps each distinct copy it finds, and
// files them as earlier versions of the key (the `<id>__v<slot>` documents
// and `<id>__versions` index the app already lists under Commissions >
// Earlier versions), so restoring one is the same click as any other.
//
// Without PITR, Firestore refuses a read more than an hour old; that is
// reported as `pitr: false` rather than as a failure, and nothing is written.

export const RECOVER_WINDOW_HOURS = 7 * 24;
const VERSIONS_KEEP = 20;
const SINGLE_DOC_MAX_BYTES = 900 * 1024;
const CHUNK_CHARS = 200 * 1024; // well under the cap even for 4-byte characters

const mirrors = (db, uid) => db.collection('userSettings').doc(uid).collection('localMirrors');
const minuteFloor = (ms) => Math.floor(ms / 60000) * 60000;

// The JSON a mirror document held, as of `readTime` (a firestore Timestamp
// or Date), or null when it didn't exist or was empty then.
async function readAsOf(db, ref, readTime) {
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return null;
    const raw = snap.data() || {};
    const count = Number(raw.chunkCount) || 0;
    if (count > 0) {
      const chunks = await t.get(ref.collection('chunks'));
      const parts = new Array(count).fill('');
      chunks.forEach((d) => {
        const i = Number(d.id);
        if (Number.isInteger(i) && i >= 0 && i < count) parts[i] = String(d.data()?.s || '');
      });
      return parts.join('') || null;
    }
    return typeof raw.json === 'string' && raw.json ? raw.json : null;
  }, { readOnly: true, readTime });
}

// Firestore's answer to a read further back than it keeps history for.
// gRPC FAILED_PRECONDITION (9) or INVALID_ARGUMENT (3), about the read time.
export function isTooOldError(err) {
  const code = err?.code;
  const codeOk = code === 9 || code === 3 || /FAILED_PRECONDITION|INVALID_ARGUMENT/i.test(String(code ?? ''));
  return codeOk && /read.?time|too old|retention|point.in.time|version/i.test(String(err?.message || ''));
}

function rowCount(json) {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : null); }
  catch { return null; }
}

// Write `json` the way utils/localMirrorSync writes a mirror document.
async function writeMirrorDoc(db, ref, json, updatedAt) {
  if (json.length <= SINGLE_DOC_MAX_BYTES / 4) {
    await ref.set({ chunkCount: 0, updatedAt, json }, { merge: true });
    return;
  }
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK_CHARS) parts.push(json.slice(i, i + CHUNK_CHARS));
  const batch = db.batch();
  parts.forEach((s, i) => batch.set(ref.collection('chunks').doc(String(i)), { s }));
  batch.set(ref, { chunkCount: parts.length, updatedAt, json: '' }, { merge: true });
  await batch.commit();
}

/**
 * Read mirror `id` for user `uid` back through the PITR window and file
 * every distinct copy found as an earlier version.
 *
 * Returns { pitr, found: [{ asOf, rows, bytes }], added, checked }: `found`
 * newest first, `added` how many were filed (copies already among the
 * versions are not filed twice). `toTimestamp(ms)` turns ms into whatever
 * readTime the db takes (a Firestore Timestamp in production).
 */
export async function recoverMirror(db, uid, id, { now = Date.now(), hours = RECOVER_WINDOW_HOURS, toTimestamp = (ms) => new Date(ms), concurrency = 12 } = {}) {
  const ref = mirrors(db, uid).doc(id);
  // Every hour back, from an hour ago (a read inside the last hour works
  // without PITR, so it can't tell us whether PITR is on).
  const times = [];
  for (let h = 1; h <= hours; h++) times.push(minuteFloor(now - h * 3600000));

  // One read from two hours ago first: refused as too old means PITR is off.
  try {
    await readAsOf(db, ref, toTimestamp(minuteFloor(now - 2 * 3600000)));
  } catch (err) {
    if (isTooOldError(err)) return { pitr: false, found: [], added: 0, checked: 0 };
    throw err;
  }

  // Points past the retention window come back "too old" and are skipped;
  // any other failure is real and is thrown once every read has finished.
  const results = new Array(times.length).fill(undefined);
  const failures = [];
  let next = 0;
  async function worker() {
    while (next < times.length) {
      const i = next++;
      try { results[i] = await readAsOf(db, ref, toTimestamp(times[i])); }
      catch (err) { if (!isTooOldError(err)) failures.push(err); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, times.length) }, worker));
  if (failures.length) throw failures[0];

  // Each distinct copy, at the newest time it was seen.
  const seen = new Map();
  times.forEach((t, i) => {
    const json = results[i];
    if (typeof json !== 'string' || !json) return;
    if (!seen.has(json)) seen.set(json, t);
  });
  const found = [...seen.entries()].map(([json, asOf]) => ({ json, asOf, rows: rowCount(json), bytes: json.length }));

  // File them as earlier versions, oldest first so the newest ends up on top,
  // skipping any copy already kept.
  const indexRef = mirrors(db, uid).doc(`${id}__versions`);
  const indexSnap = await indexRef.get();
  let index = { next: 0, list: [] };
  try {
    const v = indexSnap.exists ? JSON.parse(indexSnap.data()?.json || 'null') : null;
    if (v && Array.isArray(v.list)) index = { next: Number(v.next) || 0, list: v.list };
  } catch { /* start a fresh index */ }
  const kept = new Set();
  for (const v of index.list) {
    const s = await mirrors(db, uid).doc(`${id}__v${v.slot}`).get();
    if (s.exists && typeof s.data()?.json === 'string') kept.add(s.data().json);
  }
  let added = 0;
  // At most the newest VERSIONS_KEEP copies, so filing them can't push out
  // each other.
  const toFile = found.filter(f => !kept.has(f.json)).slice(0, VERSIONS_KEEP).reverse();
  for (const f of toFile) {
    const slot = index.next % VERSIONS_KEEP;
    await writeMirrorDoc(db, mirrors(db, uid).doc(`${id}__v${slot}`), f.json, now);
    index = {
      next: slot + 1,
      list: [{ slot, archivedAt: f.asOf, updatedAt: f.asOf, reason: 'recovered', bytes: f.bytes, rows: f.rows }, ...index.list.filter(v => v.slot !== slot)].slice(0, VERSIONS_KEEP),
    };
    added++;
  }
  if (added) await indexRef.set({ chunkCount: 0, updatedAt: now, json: JSON.stringify(index) }, { merge: true });

  return { pitr: true, found: found.map(({ asOf, rows, bytes }) => ({ asOf, rows, bytes })), added, checked: times.length };
}
