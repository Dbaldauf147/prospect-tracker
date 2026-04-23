// IndexedDB-backed storage for uploaded list overrides (RECA / CSRD /
// CDP / GRESB / SBT / Ecovadis / UN PRI). The previous localStorage
// path capped out at ~5 MB per origin which big lists like CDP
// (20k+ rows) trivially exceeded. IDB handles multi-MB JSON fine and
// is per-origin, so different users on different devices stay isolated.

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

export async function saveList(key, data) {
  if (!key) return;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, data, savedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadList(key) {
  if (!key) return null;
  try {
    const db = await openDB();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (rec?.data) return rec.data;
    // One-time migration from the legacy localStorage entry.
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
  } catch {
    return null;
  }
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
}
