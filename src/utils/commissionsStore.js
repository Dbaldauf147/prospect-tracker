// Persists the user's pasted Commissions table in localStorage, scoped
// per user so accounts sharing a browser don't inherit each other's
// roster. Empty until the first paste-import — the Commissions subtab
// on the Clients view greets a blank slate with a Paste-from-Sheets
// prompt.

import { userLsGet, userLsSet, userLsRemove } from './userLs.js';
import { registerMirroredKey, queueMirrorPush, dispatchStoreEvent } from './localMirrorSync';

const KEY = 'commissions-list-override';

// Fired whenever the roster is saved or cleared, so same-window listeners
// (the Commissions subtab, the Deals table, the YOY page) refresh — the
// native 'storage' event only fires in OTHER tabs, never the one that
// made the change.
export const COMMISSIONS_LIST_EVENT = 'commissions-list-changed';

// Mirrored to Firestore so the pasted roster survives a cleared browser or
// a move to another machine.
registerMirroredKey(KEY, COMMISSIONS_LIST_EVENT);

export const COMMISSION_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Older rosters were stored under year-tagged keys like "1/1/2026" and
// "FY2026 Revenue". The user now wants the columns to be year-agnostic
// month names ("January", "January Revenue", "FY Revenue") with the
// year stripped on paste. Translate legacy keys on load so existing
// data shows up under the new columns without forcing a re-paste.
function migrateRowKeys(row) {
  if (!row || typeof row !== 'object') return { row, changed: false };
  const out = {};
  let changed = false;
  for (const [k, v] of Object.entries(row)) {
    let newKey = k;
    const monthRev = /^(\d{1,2})\/1\/\d{4}\s+Revenue$/i.exec(k);
    if (monthRev) {
      const mi = Number(monthRev[1]);
      if (mi >= 1 && mi <= 12) newKey = `${COMMISSION_MONTH_NAMES[mi - 1]} Revenue`;
    } else {
      const month = /^(\d{1,2})\/1\/\d{4}$/.exec(k);
      if (month) {
        const mi = Number(month[1]);
        if (mi >= 1 && mi <= 12) newKey = COMMISSION_MONTH_NAMES[mi - 1];
      } else if (/^FY\d{4}\s+Revenue$/i.test(k)) {
        newKey = 'FY Revenue';
      }
    }
    if (newKey !== k) changed = true;
    if (newKey in out) {
      // Collision (e.g. two legacy rows accidentally pasted under
      // different year suffixes for the same month). Sum numeric
      // values; otherwise leave the first one.
      const existingN = Number(String(out[newKey]).replace(/[,$%]/g, ''));
      const incomingN = Number(String(v).replace(/[,$%]/g, ''));
      if (!Number.isNaN(existingN) && !Number.isNaN(incomingN)) {
        out[newKey] = existingN + incomingN;
      }
    } else {
      out[newKey] = v;
    }
  }
  return { row: out, changed };
}

function migrateAllRows(rows) {
  let anyChanged = false;
  const out = rows.map(r => {
    const { row, changed } = migrateRowKeys(r);
    if (changed) anyChanged = true;
    return row;
  });
  return { rows: out, changed: anyChanged };
}

export function loadCommissions() {
  try {
    const raw = userLsGet(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const { rows, changed } = migrateAllRows(parsed);
        // Persist the migrated keys so the next load doesn't have to
        // translate again — and so other tabs see the new shape too.
        if (changed) {
          try { userLsSet(KEY, JSON.stringify(rows)); } catch { /* ignore */ }
        }
        return { data: rows, source: 'override', count: rows.length };
      }
    }
  } catch (err) {
    console.error('Failed to read commissions override:', err);
  }
  return { data: [], source: 'empty', count: 0 };
}

export function saveCommissionsOverride(arr) {
  if (!Array.isArray(arr)) throw new Error('Commissions override must be an array');
  userLsSet(KEY, JSON.stringify(arr));
  queueMirrorPush(KEY);
  dispatchStoreEvent(COMMISSIONS_LIST_EVENT);
}

export function clearCommissionsOverride() {
  userLsRemove(KEY);
  // allowEmpty: this is the user clearing the roster on purpose, so the
  // emptiness is the thing to sync. A browser that merely LOST its copy
  // never reaches here, and so can't wipe the cloud one.
  queueMirrorPush(KEY, { allowEmpty: true });
  dispatchStoreEvent(COMMISSIONS_LIST_EVENT);
}

// Commission rows link to a client through their "Account Name" lookup
// column (the autocomplete the user fills against the prospect roster).
const ACCOUNT_NAME_KEY = 'Account Name';
const commissionMatches = (row, lowerName) =>
  String(row?.[ACCOUNT_NAME_KEY] || '').trim().toLowerCase() === lowerName;

// How many commission rows point their Account Name at `oldName` — for the
// rename confirmation summary.
export function countCommissionsClientRename(oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim();
  // Rows are found case-insensitively, but the cell stores the name as text,
  // so only an identical string means there's nothing to rewrite — a
  // capitalisation fix still has to be written through.
  if (!o || !n || String(oldName || '').trim() === n) return 0;
  return loadCommissions().data.filter(r => commissionMatches(r, o)).length;
}

// Rewrite the Account Name on every commission row that reads `oldName` onto
// `newName` so a client rename carries through to the Commissions subtab.
// Returns the number of rows changed.
export function renameCommissionsClient(oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim();
  if (!o || !n || String(oldName || '').trim() === n) return 0;
  const { data } = loadCommissions();
  let count = 0;
  const next = data.map(row => {
    if (commissionMatches(row, o)) { count++; return { ...row, [ACCOUNT_NAME_KEY]: n }; }
    return row;
  });
  if (count > 0) saveCommissionsOverride(next);
  return count;
}
