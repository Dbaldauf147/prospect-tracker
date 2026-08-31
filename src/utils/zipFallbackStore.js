// IndexedDB-backed storage for the user-uploaded city + state → zip
// fallback table. Shares the `prospect-tracker-files` DB / `uploaded-lists`
// store with utilityRatesStore (same schema) so we don't bump the DB
// version just for this file. Data is stored as a plain object
// { list, meta } so it round-trips through structured clone cleanly.
//
// `list` is an array of { city, state, zip } records. The Utility Lookup
// page folds these into the city/state → zip reverse index so a site that
// arrives with a city + state but no zip can borrow the uploaded zip even
// when the utility-rates lookup has no other site in that city.

import { doc } from 'firebase/firestore';
import { db as firestore } from '../firebase';
import { getDbUserId } from './db';
import { deleteChunkedDoc, readChunkedDoc, writeChunkedDoc } from './chunkedDoc.js';

const DB_NAME = 'prospect-tracker-files';
const STORE = 'uploaded-lists';
const DB_VERSION = 2;
const BASE_KEY = '__zip-fallback__';

// The Firestore copy, alongside the utility rates table it works with.
// Both are uploads, and losing one of them silently degrades the Utility
// Lookup rather than failing it — a site quietly stops finding its zip.
function fallbackDoc(userId) {
  return doc(firestore, 'lookupTables', String(userId), 'items', 'zip-fallback');
}

// Per-user record key so two accounts on the same browser don't share one
// cached fallback table. Pre-auth callers fall back to the bare key.
function fallbackKey() {
  const uid = getDbUserId();
  return uid ? `${uid}:${BASE_KEY}` : BASE_KEY;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('portfolio-source-files')) {
        db.createObjectStore('portfolio-source-files', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveZipFallback(list, meta = {}) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({
      key: fallbackKey(),
      data: { list, meta },
      savedAt: Date.now(),
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const userId = getDbUserId();
  if (!userId) return;
  try {
    await writeChunkedDoc(fallbackDoc(userId), { list, meta }, {
      meta: { savedAt: Date.now(), rowCount: Array.isArray(list) ? list.length : 0 },
    });
  } catch (err) {
    console.warn('Zip fallback Firestore backup failed', err);
  }
}

export async function loadZipFallback() {
  try {
    const db = await openDB();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(fallbackKey());
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (Array.isArray(rec?.data?.list)) return rec.data;
  } catch { /* fall through to the backup */ }
  return restoreZipFallback();
}

async function restoreZipFallback() {
  const userId = getDbUserId();
  if (!userId) return null;
  try {
    const remote = await readChunkedDoc(fallbackDoc(userId));
    const data = remote?.value;
    if (!Array.isArray(data?.list)) return null;
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key: fallbackKey(), data, savedAt: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch { /* cache only */ }
    return data;
  } catch (err) {
    console.warn('Zip fallback restore failed', err);
    return null;
  }
}

export async function clearZipFallback() {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(fallbackKey());
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort clear — a missing record or closed DB is fine to ignore.
  }
  const userId = getDbUserId();
  if (!userId) return;
  try { await deleteChunkedDoc(fallbackDoc(userId)); }
  catch (err) { console.warn('Zip fallback Firestore clear failed', err); }
}
