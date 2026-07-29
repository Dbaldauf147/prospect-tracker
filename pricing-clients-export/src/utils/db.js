// Single source of truth for the prospect-tracker-db IndexedDB.
//
// Stores are PARTITIONED BY USER UID: every key is automatically
// prefixed with `${uid}:` so two users on the same browser get
// isolated views of every store. Calls made before `setDbUserId` is
// invoked (i.e., before auth) are blocked / return null so we never
// accidentally mix accounts.

const DB_NAME = 'prospect-tracker-db';

// All stores now use plain (null) keyPath. Records that previously
// embedded their primary key in the value are now written with an
// explicit key argument to dbPut.
const STORES = [
  { name: 'target-accounts',     keyPath: null },
  { name: 'opps-cache',          keyPath: null },
  { name: 'opps2-cache',         keyPath: null },
  { name: 'opps2-backups',       keyPath: null },
  { name: 'clients-cache',       keyPath: null },
  { name: 'settings-backups',    keyPath: null },
  { name: 'hubspot-contacts',    keyPath: null },
  { name: 'pricing-cache',       keyPath: null },
  { name: 'daily-success-log',   keyPath: null },
  { name: 'daily-success-goals', keyPath: null },
  { name: 'pipeline-dashboard',  keyPath: null },
  { name: 'bfo-activity',        keyPath: null },
];

let dbPromise = null;
let activeUid = null;

export function setDbUserId(uid) {
  activeUid = uid || null;
}

export function getDbUserId() {
  return activeUid;
}

function scoped(key) {
  if (!activeUid) throw new Error('IndexedDB call before setDbUserId(uid). Refusing to read/write unscoped data.');
  if (key === undefined || key === null) return `${activeUid}:`;
  return `${activeUid}:${key}`;
}

function isScopedKey(key) {
  return typeof key === 'string' && activeUid && key.startsWith(`${activeUid}:`);
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const probeDb = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // Decide if we need to migrate any existing store that has a
    // non-null keyPath (the legacy daily-success-log / settings-backups
    // shapes) to a null-keyPath store. Schema changes on existing
    // stores require a versionchange transaction.
    const needsRecreate = STORES.filter(s =>
      probeDb.objectStoreNames.contains(s.name) &&
      probeDb.transaction(s.name).objectStore(s.name).keyPath !== null
    );
    const missing = STORES.filter(s => !probeDb.objectStoreNames.contains(s.name));
    if (needsRecreate.length === 0 && missing.length === 0) return probeDb;

    const nextVersion = probeDb.version + 1;
    probeDb.close();
    return await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, nextVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Drop legacy keyPath stores; recreate with null keyPath.
        // Pre-existing entries in those stores are lost — they were
        // stored unscoped (no uid) and would leak across users
        // anyway. Acceptable since these stores hold per-day notes
        // and settings snapshots, both rebuildable.
        for (const s of needsRecreate) {
          db.deleteObjectStore(s.name);
          db.createObjectStore(s.name);
        }
        for (const s of missing) {
          db.createObjectStore(s.name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // Another tab on the same origin is holding the DB open at the
      // previous version, so the upgrade can't run. Reject loudly
      // instead of hanging forever — callers can surface a "close
      // your other tabs" hint.
      req.onblocked = () => reject(new Error(
        `IndexedDB upgrade to v${nextVersion} blocked — another tab has the database open at v${probeDb.version}. Close the other tabs and reload.`
      ));
    });
  })();
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

export async function dbGet(storeName, key) {
  if (!activeUid) return undefined;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(scoped(key));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Returns only entries owned by the active user. The store may
// contain entries from other users on the same browser; those are
// filtered out by checking the key's uid prefix.
export async function dbGetAll(storeName) {
  if (!activeUid) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    let keys, vals;
    keysReq.onsuccess = () => { keys = keysReq.result; if (vals !== undefined) finish(); };
    valsReq.onsuccess = () => { vals = valsReq.result; if (keys !== undefined) finish(); };
    keysReq.onerror = () => reject(keysReq.error);
    valsReq.onerror = () => reject(valsReq.error);
    function finish() {
      const out = [];
      for (let i = 0; i < keys.length; i++) {
        if (isScopedKey(keys[i])) out.push(vals[i]);
      }
      resolve(out);
    }
  });
}

export async function dbPut(storeName, value, key) {
  if (!activeUid) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, scoped(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDelete(storeName, key) {
  if (!activeUid) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(scoped(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
