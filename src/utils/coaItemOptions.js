// The COA items every opp is asked about.
//
// This is the list behind the Opp details page's COA Approval Items table:
// every name here shows as a row on every opp (see utils/coaItems.js), and
// the item cell's dropdown offers the same names.
//
// It started as a remember-what-was-typed list — one preset ("3% esc") plus
// anything typed into an item cell, so an exception named once was offered on
// the next opp. It is now edited directly, on the Dropdowns page's COA Items
// tab: the same exceptions come up on deal after deal, and the list of them
// is the standard checklist rather than a by-product of typing. Typing a name
// into an opp still adds it here, so nothing about the old route changed.
//
// Same store as timelineTypeOptions.js, which does this for Timeline Types —
// user-scoped localStorage plus a change event and a Firestore mirror. Kept as
// its own list rather than sharing that one: the two vocabularies have nothing
// to do with each other, and merging them would offer "Budget timeline" as a
// COA item.
//
// Stored shape, and why there are two:
//   • an ARRAY is the original one — the items added on top of
//     DEFAULT_COA_ITEMS, so what it means depends on that constant.
//   • { items: [...] } is what the editable tab writes: the whole list,
//     exactly as arranged, defaults included. It has to be the whole list
//     because the tab can remove "3% esc", and under the array shape there is
//     no way to say "this default is gone" — it would come back on the next
//     read.
// Reads accept both, so a browser holding the old shape keeps the list it
// had; the first save through either route writes the new one.

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';
import { DEFAULT_COA_ITEMS, coaCatalogNames } from './coaItems.js';

const STORAGE_KEY = 'opps-coa-item-options';

// Fired in-tab whenever the list changes, so an open editor refreshes its
// rows and datalist without waiting for a reload. Cross-tab updates ride the
// native `storage` event instead.
export const COA_ITEM_OPTIONS_EVENT = 'coa-item-options-updated';

// Mirrored to Firestore: an item typed once is expected to be in the list
// forever, including on the other machine.
registerMirroredKey(STORAGE_KEY, COA_ITEM_OPTIONS_EVENT);

// Last list read, so the flag columns can ask for it per row without
// re-parsing the JSON thousands of times a render. Cleared on every write and
// on both change events — the mirror's hydration pass fires the same event a
// local save does, so a list pulled down at login invalidates this too.
let cached = null;
function invalidate() { cached = null; }
if (typeof window !== 'undefined') {
  window.addEventListener(COA_ITEM_OPTIONS_EVENT, invalidate);
  window.addEventListener('storage', invalidate);
}

function readStored() {
  try {
    const raw = userLsGet(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // The managed shape: the list as arranged, and the only shape that can
    // say a default was removed.
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      return { managed: true, items: coaCatalogNames(parsed.items) };
    }
    if (Array.isArray(parsed)) return { managed: false, items: coaCatalogNames(parsed) };
    return null;
  } catch {
    return null;
  }
}

// The list, in the order it is offered and shown. Under the legacy shape the
// presets lead and the added entries follow — what this returned before the
// tab existed.
export function loadCoaItemOptions() {
  if (cached) return cached;
  const stored = readStored();
  cached = stored?.managed
    ? [...stored.items]
    : coaCatalogNames([...DEFAULT_COA_ITEMS, ...(stored?.items || [])]);
  return cached;
}

function write(items) {
  const next = coaCatalogNames(items);
  try {
    userLsSet(STORAGE_KEY, JSON.stringify({ items: next }));
    queueMirrorPush(STORAGE_KEY);
  } catch (err) {
    console.warn('Saving COA item options failed', err);
    return false;
  }
  invalidate();
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(COA_ITEM_OPTIONS_EVENT));
    }
  } catch { /* CustomEvent unavailable */ }
  return true;
}

/**
 * Replace the whole list — what the Dropdowns tab saves after an add, a
 * rename, a removal or a move. Cleaned on the way in (trimmed, blanks
 * dropped, de-duped case-insensitively) so the tab can hand over its rows as
 * typed. Returns true when it was written.
 */
export function saveCoaItemOptions(items) {
  return write(items);
}

// Remember a typed COA item. No-op for blanks and for values already on the
// list (case-insensitive). Returns true when something new was stored, so
// callers can skip a needless event dispatch.
export function addCoaItemOption(value) {
  const label = String(value == null ? '' : value).trim();
  if (!label) return false;
  const current = loadCoaItemOptions();
  if (current.some(o => o.toLowerCase() === label.toLowerCase())) return false;
  return write([...current, label]);
}
