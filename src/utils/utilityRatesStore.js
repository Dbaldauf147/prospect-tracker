// IndexedDB-backed storage for the zip-code → utility-rates lookup.
// Shares the `prospect-tracker-files` DB with uploadedListStore so we
// don't bump the schema just for this file. Data is stored as a plain
// object { zipMap, meta } so it round-trips through structured clone
// without any surprises.

import { getDbUserId } from './db';

const DB_NAME = 'prospect-tracker-files';
const STORE = 'uploaded-lists';
const DB_VERSION = 2;
const BASE_KEY = '__utility-rates__';

// Per-user record key so two accounts on the same browser don't share
// one cached rate table. Pre-auth callers fall back to the bare key.
function ratesKey() {
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

// Normalize a zip code to its 5-digit form. Handles numbers (leading
// zero dropped by Excel), ZIP+4 ("12345-6789"), and surrounding
// whitespace. Returns '' when nothing usable.
export function normalizeZip(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const digits = raw.split('-')[0].replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 5) return digits.slice(0, 5);
  return digits.padStart(5, '0');
}

export async function saveUtilityRates(zipMap, meta = {}) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({
      key: ratesKey(),
      data: { zipMap, meta },
      savedAt: Date.now(),
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadUtilityRates() {
  try {
    const db = await openDB();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(ratesKey());
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (rec?.data?.zipMap) return rec.data;
    return null;
  } catch {
    return null;
  }
}

export async function clearUtilityRates() {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(ratesKey());
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}
