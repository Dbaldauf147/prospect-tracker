// The device's copy of the company roster, for rosterSync.js.
//
// Its own IndexedDB database rather than a store in prospect-tracker-db:
// adding a store there means a version upgrade, and an upgrade is blocked
// for as long as any other tab holds the old version open. This one is
// created once and never changes shape.
//
// One record per company, so a change rewrites only the companies that
// changed, plus one meta record. Keys are prefixed with the roster's scope
// (the signed-in user and the collection's path), so two accounts on one
// browser never see each other's companies.

import { encodeValue, decodeValue } from './rosterSync.js';

const DB_NAME = 'prospect-tracker-roster';
const DOCS = 'docs';
const META = 'meta';
const SEP = '\u0001';

let dbPromise = null;

function openRosterDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('roster copy: database blocked'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('roster copy: transaction aborted'));
  });
}

const range = (scope) => IDBKeyRange.bound(`${scope}${SEP}`, `${scope}${SEP}￿`);
const encodeDoc = (doc) => encodeValue(doc);

/**
 * The store adapter rosterSync expects, for one scope. `makeTimestamp`
 * rebuilds Firestore Timestamps (passed in so this module needn't load the
 * SDK itself).
 */
export function rosterLocalStore(scope, makeTimestamp) {
  return {
    async load() {
      const db = await openRosterDb();
      const tx = db.transaction([DOCS, META], 'readonly');
      const metaReq = tx.objectStore(META).get(scope);
      const docsReq = tx.objectStore(DOCS).getAll(range(scope));
      await done(tx);
      if (!metaReq.result) return null;
      return {
        meta: metaReq.result,
        docs: (docsReq.result || []).map(d => decodeValue(d, makeTimestamp)),
      };
    },

    async saveAll(docs, meta) {
      // Encoded before the transaction opens: a record that can't be stored
      // throws here and leaves the old copy untouched.
      const rows = docs.map(d => [`${scope}${SEP}${d.id}`, encodeDoc(d)]);
      const db = await openRosterDb();
      const tx = db.transaction([DOCS, META], 'readwrite');
      const store = tx.objectStore(DOCS);
      store.delete(range(scope));
      for (const [k, v] of rows) store.put(v, k);
      tx.objectStore(META).put({ ...meta, savedAt: Date.now() }, scope);
      await done(tx);
    },

    async apply(upserts, deleteIds, meta) {
      const rows = upserts.map(d => [`${scope}${SEP}${d.id}`, encodeDoc(d)]);
      const db = await openRosterDb();
      const tx = db.transaction([DOCS, META], 'readwrite');
      const store = tx.objectStore(DOCS);
      const metaStore = tx.objectStore(META);
      // Read-modify-write inside the transaction: another tab may have
      // moved the copy on, and its newer sync point must survive ours.
      const prev = metaStore.get(scope);
      prev.onsuccess = () => {
        if (!prev.result) { tx.abort(); return; } // no full copy to add to
        for (const [k, v] of rows) store.put(v, k);
        for (const id of deleteIds) store.delete(`${scope}${SEP}${id}`);
        metaStore.put({
          ...prev.result,
          syncedThroughMs: Math.max(prev.result.syncedThroughMs || 0, meta.syncedThroughMs || 0),
          count: meta.count,
          savedAt: Date.now(),
        }, scope);
      };
      try { await done(tx); }
      catch (err) { if (prev.result === undefined) return; throw err; }
    },
  };
}

/** Forget every device copy (all scopes). For a "something looks wrong" reset. */
export async function clearRosterCopies() {
  const db = await openRosterDb();
  const tx = db.transaction([DOCS, META], 'readwrite');
  tx.objectStore(DOCS).clear();
  tx.objectStore(META).clear();
  await done(tx);
}
