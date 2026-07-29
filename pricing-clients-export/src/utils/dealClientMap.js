// Persists user-confirmed mappings from a deal-row Client Name to a
// canonical client (prospect company name). Keyed by the lowercased
// trimmed source name so casing / whitespace drift in the pasted data
// doesn't fragment the map across imports of the same tracker. Scoped
// per user so accounts sharing a browser don't share mapping state.

import { userLsGet, userLsSet } from './userLs';

const KEY = 'deals-client-map';
const IGNORE_KEY = 'deals-client-ignore';
export const DEALS_CLIENT_MAP_EVENT = 'deals-client-map-changed';

export function loadDealClientMap() {
  try {
    const raw = userLsGet(KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

// Returns the lowercased+trimmed source names the user has marked as
// "ignore" — those rows aren't expected to map to any client (admin
// fees, internal placeholders, etc.) and shouldn't count against the
// unmapped tally.
export function loadDealClientIgnore() {
  try {
    const raw = userLsGet(IGNORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(s => String(s || '').toLowerCase().trim()).filter(Boolean) : []);
  } catch { return new Set(); }
}

function persistMap(map) {
  try {
    userLsSet(KEY, JSON.stringify(map || {}));
    window.dispatchEvent(new Event(DEALS_CLIENT_MAP_EVENT));
  } catch (err) {
    console.warn('Failed to persist deal client map', err);
  }
}

function persistIgnore(set) {
  try {
    userLsSet(IGNORE_KEY, JSON.stringify([...set]));
    window.dispatchEvent(new Event(DEALS_CLIENT_MAP_EVENT));
  } catch (err) {
    console.warn('Failed to persist deal client ignore set', err);
  }
}

export function setDealClientMapping(sourceName, target) {
  const key = String(sourceName || '').toLowerCase().trim();
  if (!key) return;
  const map = loadDealClientMap();
  if (target == null || target === '') delete map[key];
  else map[key] = String(target);
  persistMap(map);
}

export function setDealClientIgnore(sourceName, ignored) {
  const key = String(sourceName || '').toLowerCase().trim();
  if (!key) return;
  const set = loadDealClientIgnore();
  if (ignored) set.add(key);
  else set.delete(key);
  persistIgnore(set);
}

export function bulkSetDealClientIgnore(sourceNames, ignored) {
  const set = loadDealClientIgnore();
  for (const n of sourceNames) {
    const key = String(n || '').toLowerCase().trim();
    if (!key) continue;
    if (ignored) set.add(key);
    else set.delete(key);
  }
  persistIgnore(set);
}

export function bulkSetDealClientMapping(sourceNames, target) {
  const map = loadDealClientMap();
  const next = String(target || '').trim();
  for (const n of sourceNames) {
    const key = String(n || '').toLowerCase().trim();
    if (!key) continue;
    if (!next) delete map[key];
    else map[key] = next;
  }
  persistMap(map);
}

// Build the migration for a client rename: every mapping whose TARGET is the
// old client name is repointed onto the new one, so user-confirmed deal→client
// links survive a rename. Returns { updated, count } or null when nothing
// changes.
function planDealClientRename(oldName, newName) {
  const old = String(oldName || '').trim();
  const next = String(newName || '').trim();
  if (!old || !next || old.toLowerCase() === next.toLowerCase()) return null;
  const map = loadDealClientMap();
  const updated = { ...map };
  let count = 0;
  for (const [k, v] of Object.entries(updated)) {
    if (typeof v === 'string' && v.trim().toLowerCase() === old.toLowerCase()) {
      updated[k] = next;
      count++;
    }
  }
  return count > 0 ? { updated, count } : null;
}

export function countDealClientRename(oldName, newName) {
  const plan = planDealClientRename(oldName, newName);
  return plan ? plan.count : 0;
}

export function renameDealClient(oldName, newName) {
  const plan = planDealClientRename(oldName, newName);
  if (!plan) return 0;
  persistMap(plan.updated);
  return plan.count;
}

// Resolves a deal row's Client Name to its canonical client name. When
// the user has set an explicit mapping for this source name, returns
// the mapped target; otherwise returns the source name unchanged so
// auto-matching (case-insensitive equality against the prospect pool)
// can still kick in downstream.
export function resolveClientName(sourceName, map) {
  const key = String(sourceName || '').toLowerCase().trim();
  if (!key) return '';
  const explicit = (map || loadDealClientMap())[key];
  return explicit || sourceName || '';
}
