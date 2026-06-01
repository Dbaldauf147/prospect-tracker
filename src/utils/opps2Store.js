// Shared persistence for the Opps 2 store. The Opps 2 tab and any
// other view that needs to read or write opps (e.g. BFO Activity,
// which assigns BFO Opportunity Names to existing opps) go through
// these helpers so the IndexedDB cache and the chunked Firestore
// document stay in lock-step. The chunking + `_updatedAt` rules live
// here in exactly one place.

import { doc, getDoc, collection, getDocs, writeBatch, deleteField } from 'firebase/firestore';
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

// Stamp every save with a wall-clock timestamp so hydration can pick
// the strictly newer source between IDB and Firestore. Without this,
// a stale Firestore doc (e.g. when a debounced save was cancelled by
// an unmount, the doc grew past the 1 MB Firestore limit and the
// write failed silently, or the network was offline) would clobber a
// fresh local IDB cache.
export function stampUpdatedAt(data) {
  return { ...(data || {}), _updatedAt: Date.now() };
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
export async function saveOpps2ToFirestore(userId, data) {
  const stamped = stampUpdatedAt(data);
  const json = JSON.stringify(stamped);
  // Refuse to push a payload the next device can't read back. A
  // stringify result that fails its own parse would land in Firestore
  // and then make every other laptop think the cloud is empty -- their
  // load returns null, their IDB wins hydration, and the good cloud
  // copy gets stomped.
  try { JSON.parse(json); }
  catch (err) { throw new Error(`opps2: refusing to save unparseable JSON (${err.message})`); }
  const ref = doc(db, OPPS2_FIRESTORE_COLLECTION, userId);
  const updatedAt = new Date(stamped._updatedAt).toISOString();
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
