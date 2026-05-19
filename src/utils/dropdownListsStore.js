import { DROPDOWN_LISTS, SOLUTIONS_CATALOG } from '../data/dropdownLists';

// The Solutions / Service Catalog is shown alongside the named lists
// on the Dropdowns page but lives in a separate constant. Surface it
// here as a virtual list keyed `solutions` so the rest of the app can
// treat every Dropdowns-tab vocabulary uniformly (label, key, options).
const SOLUTIONS_LIST = {
  key: 'solutions',
  label: 'Solutions / Service Catalog',
  options: SOLUTIONS_CATALOG,
};

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
    const options = Array.isArray(optionOverrides[list.key]) ? optionOverrides[list.key] : list.options;
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
