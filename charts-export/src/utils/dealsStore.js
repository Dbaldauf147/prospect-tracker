// Persists a user-uploaded Deals roster in localStorage, scoped per
// user so accounts sharing a browser don't inherit each other's data.
// No bundled default — the Deals sub-tab starts empty until the user
// uploads their tracker workbook.

import { userLsGet, userLsSet, userLsRemove, userLsHas } from './userLs';

const KEY = 'deals-list-override';
// Fired whenever the deals roster is saved or cleared, so same-window
// listeners (e.g. the Issues badge) refresh — the native 'storage' event
// only fires in OTHER tabs, never the one that made the change.
export const DEALS_LIST_EVENT = 'deals-list-changed';

export function loadDealsList() {
  try {
    const raw = userLsGet(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { data: parsed, source: 'override', count: parsed.length };
    }
  } catch (err) {
    console.error('Failed to read deals override:', err);
  }
  return { data: [], source: 'empty', count: 0 };
}

export function saveDealsOverride(arr) {
  if (!Array.isArray(arr)) throw new Error('Deals override must be an array');
  userLsSet(KEY, JSON.stringify(arr));
  try { window.dispatchEvent(new Event(DEALS_LIST_EVENT)); } catch { /* no window */ }
}

export function clearDealsOverride() {
  userLsRemove(KEY);
  try { window.dispatchEvent(new Event(DEALS_LIST_EVENT)); } catch { /* no window */ }
}

export function hasDealsOverride() {
  try { return userLsHas(KEY); } catch { return false; }
}

const dealMatches = (row, lowerName) =>
  String(row?.['Client Name'] || '').trim().toLowerCase() === lowerName;

// How many deal rows carry `oldName` as their Client Name — for the rename
// confirmation summary.
export function countDealsClientRename(oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim();
  if (!o || !n || o === n.toLowerCase()) return 0;
  return loadDealsList().data.filter(r => dealMatches(r, o)).length;
}

// Rewrite the Client Name on every deal row that reads `oldName` onto
// `newName` so a client rename carries through to the Deals subtab. Returns
// the number of rows changed.
export function renameDealsClient(oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim();
  if (!o || !n || o === n.toLowerCase()) return 0;
  const { data } = loadDealsList();
  let count = 0;
  const next = data.map(row => {
    if (dealMatches(row, o)) { count++; return { ...row, 'Client Name': n }; }
    return row;
  });
  if (count > 0) saveDealsOverride(next);
  return count;
}
