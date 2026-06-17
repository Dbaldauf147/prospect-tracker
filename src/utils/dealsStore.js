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
