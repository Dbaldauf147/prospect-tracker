// Single source of truth for the prospect-tracker-db IndexedDB.
//
// Opens without a hardcoded version, inspects which stores exist, and bumps
// the version on demand to add any that are missing. Centralizing this fixes
// the VersionError caused when individual openers used different versions.

const DB_NAME = 'prospect-tracker-db';

const STORES = [
  { name: 'target-accounts',  keyPath: null },
  { name: 'opps-cache',       keyPath: null },
  { name: 'clients-cache',    keyPath: null },
  { name: 'settings-backups', keyPath: 'timestamp' },
  { name: 'hubspot-contacts', keyPath: null },
];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const probeDb = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const missing = STORES.filter(s => !probeDb.objectStoreNames.contains(s.name));
    if (missing.length === 0) return probeDb;

    const nextVersion = probeDb.version + 1;
    probeDb.close();
    return await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, nextVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s.name)) {
            if (s.keyPath) db.createObjectStore(s.name, { keyPath: s.keyPath });
            else db.createObjectStore(s.name);
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  })();
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

export async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPut(storeName, value, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    if (key === undefined) tx.objectStore(storeName).put(value);
    else tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
