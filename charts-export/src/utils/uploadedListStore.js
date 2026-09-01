// IndexedDB-backed storage for uploaded list overrides (RECA / CSRD /
// CDP / GRESB / SBT / Ecovadis / UN PRI). The previous localStorage
// path capped out at ~5 MB per origin which big lists like CDP
// (20k+ rows) trivially exceeded. IDB handles multi-MB JSON fine and
// is per-origin, so different users on different devices stay isolated.
//
// Every saveList ALSO mirrors to Firestore (chunked, see
// listBackupSync.js) so a browser "Clear site data" can't wipe a list
// — loadList falls back to the Firestore copy when IDB has nothing,
// auto-restoring it locally for fast subsequent reads.

import { saveListBackup, loadListBackup, clearListBackup } from './listBackupSync';
import { getDbUserId } from './db';

const DB_NAME = 'prospect-tracker-files';
const STORE = 'uploaded-lists';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Keep the portfolio-source-files store from v1 intact.
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

async function saveToIDB(key, data) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, data, savedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function readFromIDB(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveList(key, data) {
  if (!key) return;
  await saveToIDB(key, data);
  // Mirror to Firestore so the list survives clear-site-data and
  // syncs across devices. Fire-and-forget — IDB save is the source
  // of truth for this session.
  const uid = getDbUserId();
  if (uid) {
    saveListBackup(uid, key, data).catch(err => {
      console.warn('Firestore list backup failed', key, err);
    });
  }
}

export async function loadList(key) {
  if (!key) return null;
  try {
    const rec = await readFromIDB(key);
    if (rec?.data && Array.isArray(rec.data) && rec.data.length > 0) return rec.data;
  } catch {}
  // IDB missed — try Firestore restore (e.g., after clear-site-data
  // or signing in on a new device).
  const uid = getDbUserId();
  if (uid) {
    try {
      const remote = await loadListBackup(uid, key);
      if (Array.isArray(remote) && remote.length > 0) {
        // Reseed IDB so subsequent reads are fast.
        try { await saveToIDB(key, remote); } catch {}
        return remote;
      }
    } catch (err) {
      console.warn('loadListBackup failed', key, err);
    }
  }
  // Last-resort: legacy localStorage entry from before the IDB migration.
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        await saveList(key, parsed);
        try { localStorage.removeItem(key); } catch {}
        return parsed;
      }
    }
  } catch {}
  return null;
}

export async function clearList(key) {
  if (!key) return;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
  try { localStorage.removeItem(key); } catch {}
  const uid = getDbUserId();
  if (uid) {
    clearListBackup(uid, key).catch(err => {
      console.warn('clearListBackup failed', key, err);
    });
  }
}
