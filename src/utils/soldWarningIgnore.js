// Persists what the user has decided about the Deals-page banner that flags
// Sold Opps 2 opps with no matching deal: which flagged opps to ignore, and
// whether the banner is folded up.
//
// Ignores are keyed by a stable per-opp key (the opp's _id when present,
// otherwise an account/scope/BFO composite) so dismissing one flagged opp
// doesn't silence the rest. Both are scoped per user via userLs so accounts
// sharing a browser keep their own choices.

import { userLsGet, userLsSet, userLsRemove } from './userLs';

const KEY = 'deals-sold-warning-ignore';
const COLLAPSED_KEY = 'deals-sold-warning-collapsed';
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

// Is the banner folded up? A separate choice from ignoring the opps in it:
// ignoring says "this one isn't a deal", folding says "I've seen these, let
// me get to the table". Folded still shows the heading and its count, so a
// new Sold opp with no deal is never silent — it just doesn't take the top
// of the page with it. Defaults to open: a warning nobody has folded yet is
// a warning they haven't read.
export function loadSoldWarningCollapsed() {
  try { return userLsGet(COLLAPSED_KEY) === '1'; }
  catch { return false; }
}

export function setSoldWarningCollapsed(collapsed) {
  try {
    if (collapsed) userLsSet(COLLAPSED_KEY, '1');
    else userLsRemove(COLLAPSED_KEY);
  } catch (err) {
    console.warn('Failed to persist sold-warning collapse', err);
  }
}
