// Local IndexedDB rolling backups for the Opps 2 dataset.
//
// Opps 2 is one blob synced across devices, so a stale copy or a botched
// restore can wipe a day's edits with no way back — recovering meant a
// forensic dig through Chrome's IndexedDB blob files. This keeps a
// rolling ring of full snapshots in IndexedDB so recovery is a dropdown
// instead. Mirrors settingsBackup.js. All entries are user-scoped via
// the uid-prefixed keys provided by db.js.

import { dbGet, dbGetAll, dbPut, dbDelete } from './db';

const STORE = 'opps2-backups';
const MAX_BACKUPS = 30;

// Don't snapshot more often than this for routine autosaves — otherwise
// a flurry of edits would churn the ring in seconds and leave only a few
// minutes of history. Forced snapshots (session start, pre-import,
// pre-restore) bypass the throttle so the important boundaries are
// always captured.
const DEFAULT_MIN_INTERVAL_MS = 3 * 60 * 1000;

// Snapshot the dataset into the ring. Skips empty datasets, throttles
// routine saves, and dedups against the most recent snapshot by
// `_updatedAt`. Returns the saved entry's timestamp, or null if skipped.
export async function pushOpps2Backup(data, reason = '', { force = false, minIntervalMs = DEFAULT_MIN_INTERVAL_MS } = {}) {
  if (!data || !Array.isArray(data.records) || data.records.length === 0) return null;
  try {
    const recent = await listOpps2Backups();
    const newest = recent[0];
    if (newest) {
      // Nothing changed since the last snapshot — don't store a dupe.
      if (data._updatedAt != null && newest.updatedAt === data._updatedAt) return null;
      if (!force && Date.now() - newest.timestamp < minIntervalMs) return null;
    }
    const timestamp = Date.now();
    const entry = {
      timestamp,
      reason,
      recordCount: data.records.length,
      updatedAt: data._updatedAt ?? null,
      data: JSON.parse(JSON.stringify(data)),
    };
    await dbPut(STORE, entry, String(timestamp));
    // Trim: keep only the latest MAX_BACKUPS for this user.
    const all = await listOpps2Backups();
    if (all.length > MAX_BACKUPS) {
      const toDelete = all.slice(MAX_BACKUPS).map(b => b.timestamp);
      for (const ts of toDelete) {
        try { await dbDelete(STORE, String(ts)); } catch { /* noop */ }
      }
    }
    return timestamp;
  } catch (err) {
    console.warn('opps2Backup: pushOpps2Backup failed', err);
    return null;
  }
}

// Metadata for every backup, newest first. The full `data` blob is
// stripped so listing the ring (up to 30 full datasets) doesn't keep
// tens of MB live in React state — fetch a single one with
// getOpps2Backup when the user actually restores.
export async function listOpps2Backups() {
  try {
    const rows = await dbGetAll(STORE);
    return rows
      .map(r => ({ timestamp: r.timestamp, reason: r.reason, recordCount: r.recordCount, updatedAt: r.updatedAt }))
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

export async function getOpps2Backup(timestamp) {
  try {
    return (await dbGet(STORE, String(timestamp))) || null;
  } catch {
    return null;
  }
}

export async function deleteOpps2Backup(timestamp) {
  try {
    await dbDelete(STORE, String(timestamp));
  } catch { /* noop */ }
}

// Console escape hatch for emergency restore, mirroring
// window.__settingsBackups.
if (typeof window !== 'undefined') {
  window.__opps2Backups = { listOpps2Backups, getOpps2Backup, pushOpps2Backup, deleteOpps2Backup };
}
