// Renaming a service: the Lists tab's in-place edit of a Solutions name, and
// the service popup's editable title (ServiceDetailModal).
//
// Both make the same settings write. The list goes back with the new name,
// and the stores in settings that can't wait are moved in the same write:
// the services board (the list is served unioned with it, so a stale box
// would file the old name straight back), the rate card and the Decision
// Tree tags. Everywhere else the name is stored (per-service metadata, links,
// the Opps, the Pricing page, Deal Sizing, company cards, timelines, …) is
// moved by the rename pass in App.jsx, which reads the log entry appended
// here: logged rather than done here so browsers other than this one carry
// the rename into their own local stores too.
import { getEffectiveDropdownLists } from './dropdownListsStore.js';
import {
  getServiceCategories, pruneServicesFromCategories, renameServiceInCategories,
} from './serviceCategoriesStore.js';
import { getServicePricing, renameServicePricing } from './servicePricing.js';
import { LIBRARY_KEY, getTreeLibrary, hasSavedTrees, renameServiceInLibrary } from './treeLibrary.js';
import { SERVICE_RENAME_LOG_KEY, serviceRenameLogEntry } from './serviceNameMerges.js';

const lc = (v) => String(v ?? '').trim().toLowerCase();

// The settings patch for writing the Solutions list back as `options`.
// `edit` is { renamedFrom, renamedTo } when the edit was a rename, which the
// new array alone can't tell from a delete-plus-add.
export function solutionsListUpdates(settings, options, edit) {
  const updates = { dropdownLists: { ...(settings?.dropdownLists || {}), solutions: options } };
  // Solutions is served unioned with the services board (see
  // mergeBoardServices), so a name taken off this list has to leave its box
  // as well — otherwise the union files it straight back and the delete
  // reads as broken. A rename is the same story with the old name.
  let categories = getServiceCategories(settings);
  let moved = false;
  if (edit?.renamedFrom && edit?.renamedTo && edit.renamedFrom !== edit.renamedTo) {
    const renamed = renameServiceInCategories(categories, edit.renamedFrom, edit.renamedTo);
    if (renamed) { categories = renamed; moved = true; }
  }
  const pruned = pruneServicesFromCategories(categories, options);
  if (pruned) { categories = pruned; moved = true; }
  if (moved) updates.customServiceCategories = categories;
  if (edit?.renamedFrom && edit?.renamedTo) {
    // The rate card is keyed by service name, so a rename has to take the
    // price with it — otherwise renaming a service silently un-prices it.
    const repriced = renameServicePricing(getServicePricing(settings), edit.renamedFrom, edit.renamedTo);
    if (repriced) updates.servicePricing = repriced;
    // Same story for the steps of the Efficiency Decision Tree tagged
    // with the service: the tag is the name, so without this a rename
    // leaves every step pointing at a service nothing lists. Every tree
    // on that page, not just the open one — a subtab nobody has looked
    // at this month is exactly where a stale tag would sit unnoticed.
    // Only written when a step somewhere actually carried the old name.
    if (hasSavedTrees(settings)) {
      const retagged = renameServiceInLibrary(getTreeLibrary(settings), edit.renamedFrom, edit.renamedTo);
      if (retagged) updates[LIBRARY_KEY] = retagged;
    }
    // A change of case only is the same service to every comparison in
    // the app, so there is nothing to carry.
    if (lc(edit.renamedTo) && lc(edit.renamedFrom) !== lc(edit.renamedTo)) {
      const log = Array.isArray(settings?.[SERVICE_RENAME_LOG_KEY]) ? settings[SERVICE_RENAME_LOG_KEY] : [];
      updates[SERVICE_RENAME_LOG_KEY] = [...log, serviceRenameLogEntry(edit.renamedFrom, edit.renamedTo)];
    }
  }
  return updates;
}

// The listed spelling of `to` when it is already another service on the
// Solutions list, so the rename would fold `from` into it rather than give
// it a new name. Null when the name is free.
export function renameTargetTaken(settings, from, to) {
  if (!lc(to) || lc(to) === lc(from)) return null;
  const list = getEffectiveDropdownLists(settings).find(l => l.key === 'solutions');
  return list?.options.find(o => lc(o) === lc(to)) || null;
}

// The settings patch that renames `from` to `to`, or null when there is
// nothing to do: a blank or unchanged name, the Solutions list hidden, or
// `from` not on it (a name typed straight into a Scope cell has no row to
// rename). Where `to` is already listed the old name is dropped rather than
// listed twice, and the rename pass merges the two.
export function renameServiceUpdates(settings, from, to) {
  const next = String(to ?? '').trim();
  if (!next || next === String(from ?? '').trim()) return null;
  const list = getEffectiveDropdownLists(settings).find(l => l.key === 'solutions');
  if (!list) return null;
  const idx = list.options.findIndex(o => lc(o) === lc(from));
  if (idx < 0) return null;
  const current = list.options[idx];
  const renamed = list.options.map((o, i) => (i === idx ? next : o));
  // Where the new name was already listed, the first of the two stays.
  const firstNext = renamed.findIndex(o => lc(o) === lc(next));
  const deduped = renamed.filter((o, i) => lc(o) !== lc(next) || i === firstNext);
  return solutionsListUpdates(settings, deduped, { renamedFrom: current, renamedTo: next });
}

// The popups' rename: asks before folding one service into another, writes
// the patch, and returns the name the service now goes by (the listed
// spelling, where it merged into an existing one), or null when nothing
// was renamed.
export function renameServiceFromPopup(settings, updateSettings, from, to, confirm = (m) => window.confirm(m)) {
  const next = String(to ?? '').trim();
  const taken = renameTargetTaken(settings, from, next);
  if (taken && !confirm(`"${taken}" is already a service. Merge ${from} into it? Its notes, pricing and opps move to "${taken}", and ${from} leaves the list.`)) {
    return null;
  }
  const updates = renameServiceUpdates(settings, from, next);
  if (!updates) return null;
  updateSettings?.(updates);
  return updates.dropdownLists.solutions.find(o => lc(o) === lc(next)) || next;
}
