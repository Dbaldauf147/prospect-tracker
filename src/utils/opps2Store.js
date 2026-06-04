// Shared persistence for the Opps 2 store. The Opps 2 tab and any
// other view that needs to read or write opps (e.g. BFO Activity,
// which assigns BFO Opportunity Names to existing opps) go through
// these helpers so the IndexedDB cache and the chunked Firestore
// document stay in lock-step. The chunking + `_updatedAt` rules live
// here in exactly one place.

import { doc, getDoc, setDoc, collection, getDocs, writeBatch, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { dbGet, dbPut } from './db';

export const OPPS2_STORE = 'opps2-cache';
export const OPPS2_CACHE_KEY = 'data';
export const OPPS2_FIRESTORE_COLLECTION = 'opps2Data';

// Firestore caps a single document at ~1 MB. Once Opps 2 grows past
// that, a single-field save fails silently and cross-device sync
// stalls. The JSON is split across a `chunks` subcollection under the
// user's doc; the parent doc holds metadata. Each chunk stays well
// below the cap.
const OPPS2_CHUNK_SIZE = 700 * 1024;

// When the payload fits under this byte budget it's stored as a single
// `json` field on the parent doc and the `chunks` subcollection is left
// untouched. Leaves headroom under Firestore's ~1 MB per-doc cap for
// field names and metadata. Measured in UTF-8 bytes (not chars) so
// multi-byte content can't sneak the doc over the limit.
const OPPS2_SINGLE_DOC_MAX_BYTES = 950 * 1024;

function utf8ByteLength(str) {
  // TextEncoder is available in every browser this app runs in; the
  // char-length fallback only matters in a non-DOM environment.
  try { return new TextEncoder().encode(str).length; }
  catch { return str.length; }
}

// Stamp every save with a wall-clock timestamp so hydration can pick
// the strictly newer source between IDB and Firestore. Without this,
// a stale Firestore doc (e.g. when a debounced save was cancelled by
// an unmount, the doc grew past the 1 MB Firestore limit and the
// write failed silently, or the network was offline) would clobber a
// fresh local IDB cache.
export function stampUpdatedAt(data) {
  return { ...(data || {}), _updatedAt: Date.now() };
}

// Per-row merge of two Opps 2 datasets, with field-level resolution and
// deletion tombstones. The single source of truth for conflict
// resolution — used by hydration, the real-time listener, and the
// guarded flush below.
// Strategy:
//   • Rows in both → merged FIELD-BY-FIELD: each field takes the value
//     from whichever side stamped it more recently (`_fieldUpdatedAt`),
//     so two devices editing *different* fields of the same opp both
//     survive. Rows with no field stamps fall back to whole-row newest
//     `_rowUpdatedAt` — identical to the previous behavior, so existing
//     data is unaffected until it's edited.
//   • Rows only in one side → kept (don't drop an in-flight new row).
//   • Deletions → propagated via a `_deletedIds` map ({id: deletedAt}).
//     A row whose id is tombstoned with a time newer than the row's last
//     edit is dropped, so a delete on one device no longer resurrects
//     from a stale copy. Re-creating/editing a row after its delete (row
//     stamp newer than the tombstone) keeps it.
//   • Headers → union, `base` order preserved.
//   • columnLinks/dropdownLists → prefer `base` (the editing device).
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000; // prune deletes older than ~6 months

function fieldTime(row, fieldStamps, key) {
  const t = fieldStamps && Number(fieldStamps[key]);
  return Number.isFinite(t) ? t : (Number(row._rowUpdatedAt) || 0);
}

// Merge two versions of the SAME opp. Field-level when stamps exist,
// else whole-row newest wins (back-compat).
function mergeOpps2Row(a, b) {
  const aFs = a._fieldUpdatedAt || null;
  const bFs = b._fieldUpdatedAt || null;
  if (!aFs && !bFs) {
    return (Number(b._rowUpdatedAt) || 0) > (Number(a._rowUpdatedAt) || 0) ? b : a;
  }
  const out = { ...a };
  const stamps = { ...(aFs || {}) };
  for (const k of Object.keys(b)) {
    if (k === '_fieldUpdatedAt' || k === '_rowUpdatedAt') continue;
    if (!(k in a)) {
      // Field present only on the incoming side — keep it (union; never
      // lose a value). Field-level deletes are not propagated, matching
      // the conservative row-level deletion stance.
      out[k] = b[k];
      if (bFs && bFs[k] != null) stamps[k] = Number(bFs[k]);
    } else if (fieldTime(b, bFs, k) > fieldTime(a, aFs, k)) {
      out[k] = b[k];
      if (bFs && bFs[k] != null) stamps[k] = Number(bFs[k]);
    }
  }
  out._id = a._id;
  out.id = a.id ?? b.id;
  out._rowUpdatedAt = Math.max(Number(a._rowUpdatedAt) || 0, Number(b._rowUpdatedAt) || 0);
  if (Object.keys(stamps).length) out._fieldUpdatedAt = stamps;
  return out;
}

export function mergeOpps2Datasets(base, incoming) {
  const byId = (arr) => {
    const m = new Map();
    for (const r of (arr?.records || [])) {
      if (r && r._id != null) m.set(String(r._id), r);
    }
    return m;
  };
  const baseById = byId(base);
  const incomingById = byId(incoming);

  const merged = [];
  const seen = new Set();
  for (const [id, baseRow] of baseById) {
    seen.add(id);
    const incomingRow = incomingById.get(id);
    merged.push(incomingRow ? mergeOpps2Row(baseRow, incomingRow) : baseRow);
  }
  for (const [id, incomingRow] of incomingById) {
    if (!seen.has(id)) merged.push(incomingRow);
  }

  // Union the deletion tombstones (newest wins per id), prune ancient
  // ones, then drop any row a tombstone has buried (unless the row was
  // edited after it was deleted, i.e. re-created).
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  const deletedIds = {};
  for (const src of [base?._deletedIds, incoming?._deletedIds]) {
    if (!src) continue;
    for (const [id, t] of Object.entries(src)) {
      const ts = Number(t) || 0;
      if (ts >= cutoff && ts > (deletedIds[id] || 0)) deletedIds[id] = ts;
    }
  }
  const records = merged.filter(r => {
    const t = deletedIds[String(r._id)];
    return t == null || (Number(r._rowUpdatedAt) || 0) > t;
  });

  const baseHeaders = base?.headers || incoming?.headers || [];
  const headerSet = new Set(baseHeaders);
  const extraHeaders = (incoming?.headers || []).filter(h => h && !headerSet.has(h));
  const headers = extraHeaders.length ? [...baseHeaders, ...extraHeaders] : baseHeaders;

  const out = {
    ...(incoming || {}),
    ...(base || {}),
    headers,
    records,
    columnLinks: base?.columnLinks ?? incoming?.columnLinks,
    dropdownLists: base?.dropdownLists ?? incoming?.dropdownLists,
  };
  if (Object.keys(deletedIds).length) out._deletedIds = deletedIds;
  else delete out._deletedIds;
  return out;
}

export async function loadOpps2Cache() {
  try { return await dbGet(OPPS2_STORE, OPPS2_CACHE_KEY); }
  catch (err) { console.error('opps2: IndexedDB load failed', err); return null; }
}

export async function saveOpps2Cache(data) {
  try { await dbPut(OPPS2_STORE, stampUpdatedAt(data), OPPS2_CACHE_KEY); }
  catch (err) { console.error('opps2: IndexedDB save failed', err); }
}

export async function loadOpps2FromFirestore(userId) {
  try {
    const ref = doc(db, OPPS2_FIRESTORE_COLLECTION, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const raw = snap.data() || {};
    let json = null;
    if (Number.isFinite(raw.chunkCount) && raw.chunkCount > 0) {
      const parts = new Array(raw.chunkCount).fill('');
      const chunksSnap = await getDocs(collection(ref, 'chunks'));
      chunksSnap.forEach((d) => {
        const idx = Number(d.id);
        if (Number.isFinite(idx) && idx >= 0 && idx < parts.length) {
          parts[idx] = String(d.data()?.json || '');
        }
      });
      json = parts.join('');
    } else if (raw.json) {
      json = raw.json;
    }
    if (!json) return null;
    const parsed = JSON.parse(json);
    // Lift the doc's stored updatedAt onto the payload so the
    // hydration timestamp compare works even when the json blob
    // predates the _updatedAt stamp inside it.
    if (parsed && parsed._updatedAt == null && raw.updatedAt) {
      const t = Date.parse(raw.updatedAt);
      if (Number.isFinite(t)) parsed._updatedAt = t;
    }
    return parsed;
  } catch (err) { console.error('opps2: Firestore load failed', err); }
  return null;
}

// Throws when the save fails so callers (e.g. the Import button) can
// surface the failure instead of silently leaving stale data behind.
export async function saveOpps2ToFirestore(userId, data, { allowEmpty = false } = {}) {
  const stamped = stampUpdatedAt(data);
  const ref = doc(db, OPPS2_FIRESTORE_COLLECTION, userId);

  // Structural guard: a payload with no `records` array is corruption,
  // not a save — never let it reach the cloud.
  const incomingRecords = Array.isArray(stamped.records) ? stamped.records : null;
  if (incomingRecords === null) {
    throw new Error('opps2: refusing to save — payload has no records array');
  }

  // Anti-wipe guard: refuse to replace a populated cloud dataset with an
  // empty one (the catastrophic clobber, regardless of any higher-level
  // bug). A genuinely empty/new dataset still saves because the prior
  // doc is empty too. Only the rare empty-incoming case pays for the
  // prior read/parse, so normal saves are unaffected. `allowEmpty: true`
  // is the deliberate escape hatch for an intentional clear-all.
  if (!allowEmpty && incomingRecords.length === 0) {
    let priorPopulated = false;
    let priorCount = 0;
    try {
      const priorSnap = await getDoc(ref);
      const prior = priorSnap.exists() ? priorSnap.data() : null;
      if (prior) {
        if (Number(prior.chunkCount) > 0) {
          priorPopulated = true; // was chunked => definitely had data
        } else if (typeof prior.json === 'string' && prior.json) {
          try { priorCount = (JSON.parse(prior.json)?.records || []).length; priorPopulated = priorCount > 0; }
          catch { /* unreadable prior — don't block on it */ }
        }
      }
    } catch { /* prior read failed — don't block a legitimate empty save */ }
    if (priorPopulated) {
      throw new Error(`opps2: refusing to overwrite a populated cloud dataset (${priorCount || 'chunked'} rows) with an empty one. Pass { allowEmpty: true } to force a clear-all.`);
    }
  }

  const json = JSON.stringify(stamped);
  // Refuse to push a payload the next device can't read back. A
  // stringify result that fails its own parse would land in Firestore
  // and then make every other laptop think the cloud is empty -- their
  // load returns null, their IDB wins hydration, and the good cloud
  // copy gets stomped.
  try { JSON.parse(json); }
  catch (err) { throw new Error(`opps2: refusing to save unparseable JSON (${err.message})`); }
  const updatedAt = new Date(stamped._updatedAt).toISOString();

  // Single-document fast path. When the payload fits comfortably under
  // Firestore's per-doc cap, store it as one `json` field on the parent
  // doc and never touch the `chunks` subcollection. This keeps the
  // common case to a single write *and* means the save only needs
  // access to opps2Data/{uid} itself — so it works even if the chunks
  // subcollection rule isn't deployed. loadOpps2FromFirestore already
  // prefers raw.json whenever chunkCount isn't a positive number.
  if (utf8ByteLength(json) <= OPPS2_SINGLE_DOC_MAX_BYTES) {
    // Read the parent doc (not the chunks list) to learn whether a
    // previous larger save left chunks behind. Avoiding getDocs on the
    // subcollection keeps this path independent of the chunks rule.
    let priorChunkCount = 0;
    try { priorChunkCount = Number((await getDoc(ref)).data()?.chunkCount) || 0; }
    catch { priorChunkCount = 0; }
    await setDoc(ref, { chunkCount: 0, updatedAt, json }, { merge: true });
    // Best-effort: delete chunks from a previous chunked save. The
    // loader now ignores them (chunkCount is 0), so a failure here —
    // e.g. a missing chunks rule — is harmless dead data, not a lost
    // save. Done in a separate commit so it can't abort the json write.
    if (priorChunkCount > 0) {
      try {
        const cleanup = writeBatch(db);
        for (let i = 0; i < priorChunkCount; i++) {
          cleanup.delete(doc(ref, 'chunks', String(i)));
        }
        await cleanup.commit();
      } catch (err) { console.warn('opps2: stale chunk cleanup failed (harmless)', err); }
    }
    return stamped._updatedAt;
  }

  // Chunked path for datasets past the single-doc budget: split the JSON
  // across the `chunks` subcollection; the parent doc holds metadata.
  const chunks = [];
  for (let i = 0; i < json.length; i += OPPS2_CHUNK_SIZE) {
    chunks.push(json.slice(i, i + OPPS2_CHUNK_SIZE));
  }
  // Drop any leftover chunks from a previous (larger) save so a
  // shrinking dataset doesn't reassemble with stale tail data.
  const existing = await getDocs(collection(ref, 'chunks'));
  const batch = writeBatch(db);
  // merge: true is required so deleteField() takes effect -- in a
  // plain set() the Firestore SDK throws and the whole batch aborts,
  // and trySaveOpps2ToFirestore's catch silently swallows the failure
  // (which is how every chunked save was a no-op).
  batch.set(ref, { chunkCount: chunks.length, updatedAt, json: deleteField() }, { merge: true });
  for (let i = 0; i < chunks.length; i++) {
    batch.set(doc(ref, 'chunks', String(i)), { json: chunks[i] });
  }
  existing.forEach((d) => {
    const idx = Number(d.id);
    if (!Number.isFinite(idx) || idx >= chunks.length) batch.delete(d.ref);
  });
  await batch.commit();
  return stamped._updatedAt;
}

// Non-throwing wrapper for the auto-save / unmount / beforeunload
// callers that don't have a UI surface for failures — they just want
// best-effort durability and a console error on failure.
export async function trySaveOpps2ToFirestore(userId, data) {
  try { return await saveOpps2ToFirestore(userId, data); }
  catch (err) { console.error('opps2: Firestore save failed', err); return null; }
}

// Guarded flush for the unmount / beforeunload paths. Those fire from
// tabs that may hold a STALE full dataset; a blind overwrite there is
// exactly how a background tab closing hours later reverted edits made
// elsewhere. Merge against the current cloud copy first so the write can
// only ever carry rows that are newer than (or equal to) what's already
// in Firestore — a stale row can no longer win. Returns the saved
// timestamp on success, null on failure (best-effort; never throws).
export async function flushOpps2ToFirestore(userId, data) {
  if (!userId || !data) return null;
  try {
    const remote = await loadOpps2FromFirestore(userId);
    const merged = remote ? mergeOpps2Datasets(data, remote) : data;
    return await saveOpps2ToFirestore(userId, merged);
  } catch (err) {
    console.error('opps2: guarded flush failed', err);
    return null;
  }
}

// Pick the strictly-newer of the IndexedDB cache and the Firestore doc,
// mirroring the Opps 2 tab's hydration so a write originating from
// another view doesn't build on stale local data.
export async function loadOpps2Newest(userId) {
  const [cache, remote] = await Promise.all([
    loadOpps2Cache(),
    userId ? loadOpps2FromFirestore(userId) : Promise.resolve(null),
  ]);
  if (!cache) return remote;
  if (!remote) return cache;
  const ct = Number(cache._updatedAt) || 0;
  const rt = Number(remote._updatedAt) || 0;
  return rt > ct ? remote : cache;
}

// Assign a BFO Opportunity Name (the "BFO Link" field) to the opp with
// the given `_id`, persisting to both the cache and Firestore. Reads
// the newest available data first so we don't clobber a concurrent
// edit from the Opps 2 tab. Returns the updated data object; throws if
// the data isn't loaded yet or the opp can't be found.
export async function setOppBfoLink(userId, oppId, bfoLink) {
  const data = await loadOpps2Newest(userId);
  if (!data || !Array.isArray(data.records)) {
    throw new Error('Opps 2 data has not loaded yet.');
  }
  let found = false;
  const records = data.records.map((r) => {
    if (String(r?._id) === String(oppId)) {
      found = true;
      return { ...r, 'BFO Link': bfoLink, _rowUpdatedAt: Date.now() };
    }
    return r;
  });
  if (!found) throw new Error(`Opp #${oppId} not found on Opps 2.`);
  const next = { ...data, records };
  await saveOpps2Cache(next);
  await trySaveOpps2ToFirestore(userId, next);
  return next;
}
