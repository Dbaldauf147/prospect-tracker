// Local IndexedDB backup for userSettings.
//
// Every time we're about to write settings to Firestore, push the
// previous settings here so we can recover from an accidental
// cross-device overwrite. All entries are user-scoped via the
// uid-prefixed keys provided by db.js.

import { dbGet, dbGetAll, dbPut, dbDelete } from './db';

const STORE = 'settings-backups';
const MAX_BACKUPS = 30;

export async function pushBackup(settings, reason = '') {
  if (!settings || typeof settings !== 'object') return;
  try {
    const timestamp = Date.now();
    const entry = {
      timestamp,
      reason,
      data: JSON.parse(JSON.stringify(settings)),
    };
    await dbPut(STORE, entry, String(timestamp));
    // Trim: keep only the latest MAX_BACKUPS for this user.
    const all = await listBackups();
    if (all.length > MAX_BACKUPS) {
      const toDelete = all.slice(MAX_BACKUPS).map(b => b.timestamp);
      for (const ts of toDelete) {
        try { await dbDelete(STORE, String(ts)); } catch { /* noop */ }
      }
    }
  } catch (err) {
    console.warn('settingsBackup: pushBackup failed', err);
  }
}

export async function listBackups() {
  try {
    const rows = await dbGetAll(STORE);
    return [...rows].sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

export async function getBackup(timestamp) {
  try {
    return (await dbGet(STORE, String(timestamp))) || null;
  } catch {
    return null;
  }
}

export async function deleteBackup(timestamp) {
  try {
    await dbDelete(STORE, String(timestamp));
  } catch { /* noop */ }
}

// Console escape hatch for emergency restore.
if (typeof window !== 'undefined') {
  window.__settingsBackups = { listBackups, getBackup, pushBackup };
}
