// The COA items offered in the Opp details page's COA Approval table.
//
// One preset ships ("3% esc"); anything typed into an item cell is remembered
// here so it joins the dropdown for the next opp. A COA exception asked for
// once tends to be asked for again, and re-typing it on each opp is both a
// chore and how the same exception ends up stored under three spellings.
//
// Same store as timelineTypeOptions.js, which does this for Timeline Types —
// user-scoped localStorage plus a change event and a Firestore mirror. Kept as
// its own list rather than sharing that one: the two vocabularies have nothing
// to do with each other, and merging them would offer "Budget timeline" as a
// COA item.

import { userLsGet, userLsSet } from './userLs';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';
import { DEFAULT_COA_ITEMS } from './coaItems.js';

const STORAGE_KEY = 'opps-coa-item-options';

// Fired in-tab whenever the custom list changes, so an open editor refreshes
// its datalist without waiting for a reload. Cross-tab updates ride the native
// `storage` event instead.
export const COA_ITEM_OPTIONS_EVENT = 'coa-item-options-updated';

// Mirrored to Firestore: an item typed once is expected to be in the dropdown
// forever, including on the other machine.
registerMirroredKey(STORAGE_KEY, COA_ITEM_OPTIONS_EVENT);

function readCustom() {
  try {
    const raw = userLsGet(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(v => typeof v === 'string' && v.trim() !== '');
  } catch {
    return [];
  }
}

// Presets + saved entries, de-duped case-insensitively with the presets
// first. The label shown is the first spelling seen for a given case-folded
// key, so "3% ESC" and "3% esc" collapse to one option instead of both
// cluttering the list.
export function loadCoaItemOptions() {
  const out = [];
  const seen = new Set();
  for (const v of [...DEFAULT_COA_ITEMS, ...readCustom()]) {
    const label = String(v).trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

// Remember a typed COA item. No-op for blanks and for values already offered
// (preset or custom, case-insensitive). Returns true when something new was
// stored, so callers can skip a needless event dispatch.
export function addCoaItemOption(value) {
  const label = String(value == null ? '' : value).trim();
  if (!label) return false;
  const existing = new Set(loadCoaItemOptions().map(o => o.toLowerCase()));
  if (existing.has(label.toLowerCase())) return false;
  const nextCustom = [...readCustom(), label];
  try {
    userLsSet(STORAGE_KEY, JSON.stringify(nextCustom));
    queueMirrorPush(STORAGE_KEY);
  } catch (err) {
    console.warn('Saving COA item option failed', err);
    return false;
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(COA_ITEM_OPTIONS_EVENT));
    }
  } catch { /* CustomEvent unavailable */ }
  return true;
}
