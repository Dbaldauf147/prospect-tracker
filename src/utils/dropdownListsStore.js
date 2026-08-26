import { DROPDOWN_LISTS, SOLUTIONS_CATALOG } from '../data/dropdownLists';
import { boardServiceNames, sortServiceNames } from './serviceCategoriesStore';

// The Solutions / Service Catalog is shown alongside the named lists
// on the Dropdowns page but lives in a separate constant. Surface it
// here as a virtual list keyed `solutions` so the rest of the app can
// treat every Dropdowns-tab vocabulary uniformly (label, key, options).
const SOLUTIONS_LIST = {
  key: 'solutions',
  label: 'Solutions / Service Catalog',
  options: SOLUTIONS_CATALOG,
};

// The Solutions list and the services board are one vocabulary held in two
// places: the list (settings.dropdownLists.solutions) is what Scope cells and
// the Dropdowns › Services table read, the board layout
// (settings.customServiceCategories) is what the Scope picker and the company
// card group into boxes. They used to drift — the seeds alone disagreed on 24
// services, all of them pickable in Scope but absent from the Services table.
//
// So the list is served as the union of the two: every service filed in a box
// is in the list, whether or not anyone put it there. Nothing is written to do
// it, so it holds on every device from the first render, and a service filed
// into a box later joins the list the moment it lands.
//
// The other direction needs no merge — a service in the list that no box
// claims already shows up, in the Scope picker's "Other services" card and
// with that bucket on the Services table.
//
// Deletes and renames on the list are the one thing this can't do alone: both
// have to move on the board too, or the union puts the old name straight back.
// DropdownsView's saveList does that half (pruneServicesFromCategories,
// renameServiceInCategories).
//
// Sorted, because a merged-in name has to land somewhere and a 160-entry
// service catalog is read alphabetically — the same collator the boxes on the
// board sort by, so "Cat 9" still comes before "Cat 10". Sorting by the stored
// name rather than any serviceRenames alias: the list holds the underlying
// names, which is what Scope values are stored under.
export function mergeBoardServices(options, settings) {
  const merged = [...(options || [])];
  const have = new Set(merged.map(o => String(o).trim().toLowerCase()));
  for (const item of boardServiceNames(settings)) {
    const key = String(item).trim().toLowerCase();
    if (!key || have.has(key)) continue;
    have.add(key);
    merged.push(item);
  }
  return sortServiceNames(merged);
}

// How many services the merge above contributes — board services the stored
// Solutions list never had. The Services subtab shows it to explain rows the
// user didn't add there; it drops to zero once an edit to the list writes the
// merged array back.
export function boardOnlyServiceCount(settings) {
  const stored = Array.isArray(settings?.dropdownLists?.solutions)
    ? settings.dropdownLists.solutions
    : SOLUTIONS_CATALOG;
  const have = new Set(stored.map(o => String(o).trim().toLowerCase()));
  return boardServiceNames(settings)
    .filter(n => !have.has(String(n).trim().toLowerCase()))
    .length;
}

// The full set of built-in lists the Dropdowns tab knows about. Order
// matters here: it's the order the cards render in.
export const BUILTIN_DROPDOWN_LISTS = [...DROPDOWN_LISTS, SOLUTIONS_LIST];

// User-defined lists live under `custom:` to keep them out of the
// built-in keyspace. New keys are slugged from the label + a short
// suffix so similar labels don't collide.
export const CUSTOM_LIST_PREFIX = 'custom:';
export function isCustomListKey(key) { return String(key || '').startsWith(CUSTOM_LIST_PREFIX); }
export function makeCustomListKey(label) {
  const slug = String(label || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
  return `${CUSTOM_LIST_PREFIX}${slug}:${Date.now().toString(36)}`;
}

// Apply user customizations on top of the built-in vocabulary:
//   settings.dropdownLists       → per-list option overrides
//   settings.dropdownListLabels  → per-list label renames (built-ins and customs)
//   settings.dropdownListsHidden → array of built-in keys to omit
//   settings.dropdownCustomLists → user-created lists [{ key, label, options }]
// Returns one flat { key, label, options, builtin } array so callers
// (Dropdowns view, column linking) can stay on one code path.
export function getEffectiveDropdownLists(settings) {
  const optionOverrides = settings?.dropdownLists || {};
  const labelOverrides = settings?.dropdownListLabels || {};
  const hidden = new Set(Array.isArray(settings?.dropdownListsHidden) ? settings.dropdownListsHidden : []);
  const customLists = Array.isArray(settings?.dropdownCustomLists) ? settings.dropdownCustomLists : [];

  const out = [];
  for (const list of BUILTIN_DROPDOWN_LISTS) {
    if (hidden.has(list.key)) continue;
    const stored = Array.isArray(optionOverrides[list.key]) ? optionOverrides[list.key] : list.options;
    // Solutions carries the services board's vocabulary too — see
    // mergeBoardServices. Every other list is served as stored.
    const options = list.key === 'solutions' ? mergeBoardServices(stored, settings) : stored;
    const label = labelOverrides[list.key] || list.label;
    out.push({ key: list.key, label, options, builtin: true });
  }
  for (const list of customLists) {
    if (!list?.key) continue;
    const options = Array.isArray(optionOverrides[list.key])
      ? optionOverrides[list.key]
      : (Array.isArray(list.options) ? list.options : []);
    const label = labelOverrides[list.key] || list.label || 'Untitled list';
    out.push({ key: list.key, label, options, builtin: false });
  }
  return out;
}
