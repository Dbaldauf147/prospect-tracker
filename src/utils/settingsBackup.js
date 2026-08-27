// Local IndexedDB backup for userSettings.
//
// Every time we're about to write settings to Firestore, push the
// previous settings here so we can recover from an accidental
// cross-device overwrite. All entries are user-scoped via the
// uid-prefixed keys provided by db.js.

import { dbGet, dbGetAll, dbPut, dbDelete } from './db';

const STORE = 'settings-backups';
const MAX_BACKUPS = 30;

// One backup per burst of saves.
//
// A backup is a deep clone of the whole settings document written to
// IndexedDB, and the store keeps only the latest MAX_BACKUPS. The contact
// popup's tag table saves on every click, so backing up each save did two
// unhelpful things at once: it cloned the entire document on the main thread
// per click — a big part of why a run down that table felt slow — and it
// pushed the genuinely useful older snapshots out of the store within a
// minute. Recovery wants the state before a burst of edits, which the first
// save of the burst already captured; pass { force: true } for a backup that
// must be taken regardless.
export const BACKUP_MIN_INTERVAL_MS = 30000;
let lastPushAt = 0;

export async function pushBackup(settings, reason = '', { force = false } = {}) {
  if (!settings || typeof settings !== 'object') return;
  const now = Date.now();
  if (!force && lastPushAt && now - lastPushAt < BACKUP_MIN_INTERVAL_MS) return;
  lastPushAt = now;
  try {
    const timestamp = now;
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
  // Forced: a backup asked for by hand is always wanted, whatever the
  // throttle above would have said.
  window.__settingsBackups = {
    listBackups,
    getBackup,
    pushBackup: (settings, reason = 'manual') => pushBackup(settings, reason, { force: true }),
  };
}
