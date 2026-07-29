// Persists the "ignore this warning" choices for the Deals-page banner
// that flags Sold Opps 2 opps with no matching deal. Keyed by a stable
// per-opp key (the opp's _id when present, otherwise an account/scope/
// BFO composite) so dismissing one flagged opp doesn't silence the rest.
// Scoped per user via userLs so accounts sharing a browser keep their
// own dismissals.

import { userLsGet, userLsSet, userLsRemove } from './userLs';

const KEY = 'deals-sold-warning-ignore';
export const SOLD_WARNING_IGNORE_EVENT = 'deals-sold-warning-ignore-changed';

export function loadSoldWarningIgnore() {
  try {
    const raw = userLsGet(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(s => String(s || '')).filter(Boolean) : []);
  } catch { return new Set(); }
}

function persist(set) {
  try {
    userLsSet(KEY, JSON.stringify([...set]));
    window.dispatchEvent(new Event(SOLD_WARNING_IGNORE_EVENT));
  } catch (err) {
    console.warn('Failed to persist sold-warning ignore set', err);
  }
}

export function setSoldWarningIgnore(oppKey, ignored) {
  const key = String(oppKey || '').trim();
  if (!key) return;
  const set = loadSoldWarningIgnore();
  if (ignored) set.add(key);
  else set.delete(key);
  persist(set);
}

// Clears every dismissal so all currently-flagged opps reappear. Used by
// the banner's "Reset" affordance.
export function clearSoldWarningIgnore() {
  try {
    userLsRemove(KEY);
    window.dispatchEvent(new Event(SOLD_WARNING_IGNORE_EVENT));
  } catch (err) {
    console.warn('Failed to clear sold-warning ignore set', err);
  }
}
