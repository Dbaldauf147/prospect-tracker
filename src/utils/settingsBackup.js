// Local IndexedDB backup for userSettings.
//
// Every time we're about to write settings to Firestore, push the
// previous settings here so we can recover from an accidental
// cross-device overwrite.

const DB_NAME = 'prospect-tracker-db';
const STORE = 'settings-backups';
const MAX_BACKUPS = 30;

function openDB() {
  return new Promise((resolve, reject) => {
    // Use a version bump that upgrades in place; opens as latest version.
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Need to upgrade to add the store.
        const version = db.version + 1;
        db.close();
        const upgradeReq = indexedDB.open(DB_NAME, version);
        upgradeReq.onupgradeneeded = () => {
          const udb = upgradeReq.result;
          if (!udb.objectStoreNames.contains(STORE)) {
            udb.createObjectStore(STORE, { keyPath: 'timestamp' });
          }
        };
        upgradeReq.onsuccess = () => resolve(upgradeReq.result);
        upgradeReq.onerror = () => reject(upgradeReq.error);
        return;
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function pushBackup(settings, reason = '') {
  if (!settings || typeof settings !== 'object') return;
  try {
    const db = await openDB();
    const timestamp = Date.now();
    const entry = {
      timestamp,
      reason,
      data: JSON.parse(JSON.stringify(settings)),
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    // Trim: keep only the latest MAX_BACKUPS.
    const all = await listBackups();
    if (all.length > MAX_BACKUPS) {
      const toDelete = all.slice(MAX_BACKUPS).map(b => b.timestamp);
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        toDelete.forEach(ts => store.delete(ts));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } catch (err) {
    console.warn('settingsBackup: pushBackup failed', err);
  }
}

export async function listBackups() {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        rows.sort((a, b) => b.timestamp - a.timestamp);
        resolve(rows);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function getBackup(timestamp) {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(timestamp);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteBackup(timestamp) {
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(timestamp);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

// Console escape hatch for emergency restore.
if (typeof window !== 'undefined') {
  window.__settingsBackups = { listBackups, getBackup, pushBackup };
}
