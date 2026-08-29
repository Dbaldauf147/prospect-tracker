// Persists a user-uploaded Deals roster in localStorage, scoped per
// user so accounts sharing a browser don't inherit each other's data.
// No bundled default — the Deals sub-tab starts empty until the user
// uploads their tracker workbook.

import { userLsGet, userLsSet, userLsRemove, userLsHas } from './userLs';
import { registerMirroredKey, queueMirrorPush, dispatchStoreEvent } from './localMirrorSync';

const KEY = 'deals-list-override';
// Fired whenever the deals roster is saved or cleared, so same-window
// listeners (e.g. the Issues badge) refresh — the native 'storage' event
// only fires in OTHER tabs, never the one that made the change.
export const DEALS_LIST_EVENT = 'deals-list-changed';

// Mirrored to Firestore so the roster survives a cleared browser or a move
// to another machine — losing it used to leave every active client without
// a contract End Date, which the Issues tab reports as "No expiration date".
registerMirroredKey(KEY, DEALS_LIST_EVENT);

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
  queueMirrorPush(KEY);
  dispatchStoreEvent(DEALS_LIST_EVENT);
}

export function clearDealsOverride() {
  userLsRemove(KEY);
  // allowEmpty: this is the user clearing the roster on purpose, so the
  // emptiness is the thing to sync. A browser that merely LOST its copy
  // never reaches here, and so can't wipe the cloud one.
  queueMirrorPush(KEY, { allowEmpty: true });
  dispatchStoreEvent(DEALS_LIST_EVENT);
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
  // Rows are found case-insensitively, but the cell stores the name as text,
  // so only an identical string means there's nothing to rewrite — a
  // capitalisation fix still has to be written through.
  if (!o || !n || String(oldName || '').trim() === n) return 0;
  return loadDealsList().data.filter(r => dealMatches(r, o)).length;
}

// Rewrite the Client Name on every deal row that reads `oldName` onto
// `newName` so a client rename carries through to the Deals subtab. Returns
// the number of rows changed.
export function renameDealsClient(oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim();
  if (!o || !n || String(oldName || '').trim() === n) return 0;
  const { data } = loadDealsList();
  let count = 0;
  const next = data.map(row => {
    if (dealMatches(row, o)) { count++; return { ...row, 'Client Name': n }; }
    return row;
  });
  if (count > 0) saveDealsOverride(next);
  return count;
}

// The deal columns the Contract Services subtab writes commercial terms
// into. Keys are the canonical names DealsView normalises uploaded headers
// onto, so a workbook that spelled a header differently still lands here.
export const DEAL_TERM_FIELDS = [
  { key: 'Current Term Start Date', label: 'Start date',    from: 'termStart' },
  { key: 'End Date',                label: 'End date',      from: 'termEnd' },
  { key: 'Auto renewal?',           label: 'Auto renewal',  from: 'autoRenewal' },
  { key: 'Esc',                     label: 'Esc',           from: 'escalator' },
  { key: 'Payment Terms',           label: 'Payment terms', from: 'paymentTerms' },
];

/**
 * Write commercial terms onto one deal row.
 *
 * The roster is a flat array in localStorage with no row ids, so the row is
 * addressed by index — and re-read here rather than trusted from the
 * caller's copy, because the Deals subtab may have been re-uploaded in
 * another tab since. `guard` is the row as the caller last saw it: if the
 * row at that index no longer carries the same Client Name and Agreement
 * Name, the write is refused rather than landing on somebody else's deal.
 *
 * Only non-empty values are written, so a term the contract didn't state
 * leaves whatever is already on the deal alone.
 *
 * Returns { ok, error, written: [keys] }.
 */
export function applyDealTerms(index, guard, terms) {
  const { data } = loadDealsList();
  const row = data[index];
  if (!row) return { ok: false, error: 'That deal is no longer in the roster — reload the Deals subtab.', written: [] };
  const same = (k) => String(row[k] ?? '').trim() === String(guard?.[k] ?? '').trim();
  if (!same('Client Name') || !same('Agreement Name')) {
    return { ok: false, error: 'The Deals roster changed since this list was built — reopen the picker and try again.', written: [] };
  }
  const patch = {};
  for (const f of DEAL_TERM_FIELDS) {
    const v = String(terms?.[f.from] ?? '').trim();
    if (v) patch[f.key] = v;
  }
  const written = Object.keys(patch);
  if (written.length === 0) return { ok: false, error: 'None of the five terms has a value to write.', written: [] };
  const next = data.slice();
  next[index] = { ...row, ...patch };
  saveDealsOverride(next);
  return { ok: true, error: '', written };
}
