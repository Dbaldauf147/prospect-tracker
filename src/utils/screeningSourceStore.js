// IndexedDB-backed storage for the Building Compliance Screening source
// workbook the user uploads on the Utility Lookup → Compliance Screening
// subtab. Unlike uploadedListStore (which only round-trips row arrays),
// this keeps a single compact object — { compCols, index, profiles } —
// so we don't have to re-parse a 60k-row workbook on every visit.
//
// A bundled default dataset always ships with the app, so if this store
// is empty (or gets wiped by clear-site-data) the screening still works;
// the upload just overrides the default locally.

const DB_NAME = 'prospect-tracker-screening';
const STORE = 'screening-source';
const DB_VERSION = 1;
const KEY = 'building-compliance';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveScreeningSource(data) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key: KEY, data, savedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadScreeningSource() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result?.data || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearScreeningSource() {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort clear — a missing DB/store is fine to ignore.
  }
}
