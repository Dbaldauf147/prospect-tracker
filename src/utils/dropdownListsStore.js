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

// Apply the user's per-list option overrides on top of the built-in
// vocabulary. `settings.dropdownLists` is shaped like
//   { [listKey]: ['Option A', 'Option B', ...] }
// and only contains entries for lists the user has touched — keys
// without an override fall through to the built-in options. Returns
// the same `{ key, label, options }` shape so callers (Dropdowns view,
// column linking) can use one code path.
export function getEffectiveDropdownLists(settings) {
  const overrides = settings?.dropdownLists || {};
  return BUILTIN_DROPDOWN_LISTS.map(list => {
    const ov = overrides[list.key];
    if (Array.isArray(ov)) return { ...list, options: ov };
    return list;
  });
}
