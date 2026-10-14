// Sub verticals, mapped from verticals.
//
// Each vertical on the Dropdowns > Vertical list can carry its own list of
// sub verticals, and a company's Sub Vertical is picked from the list of the
// Vertical it has. The lists are edited from the Sub Vertical field itself on
// the company popup, so they live per user in settings:
//
//   settings.subVerticalsByVertical = { 'Healthcare': ['Hospitals', ...] }
//
// Keyed by the vertical's name as it appears on the list; looked up without
// regard to case or surrounding spaces, so a vertical retyped as
// "healthcare " still finds its list. Pure (scripts/subVerticals.test.mjs).

const keyOf = (s) => String(s || '').trim().toLowerCase();
const clean = (s) => String(s || '').trim();

// The map's own key for a vertical: an existing key that matches, else the
// vertical as given (trimmed).
function mapKey(map, vertical) {
  const want = keyOf(vertical);
  return Object.keys(map || {}).find(k => keyOf(k) === want) || clean(vertical);
}

/** The sub verticals listed under a vertical ([] for none / no vertical). */
export function subVerticalsFor(map, vertical) {
  if (!keyOf(vertical)) return [];
  const list = (map || {})[mapKey(map, vertical)];
  return Array.isArray(list) ? list.map(clean).filter(Boolean) : [];
}

/** A new map with `value` appended to the vertical's list (no duplicates). */
export function withSubVertical(map, vertical, value) {
  const v = clean(value);
  if (!keyOf(vertical) || !v) return map || {};
  const key = mapKey(map, vertical);
  const list = subVerticalsFor(map, vertical);
  if (list.some(x => keyOf(x) === keyOf(v))) return map || {};
  return { ...(map || {}), [key]: [...list, v] };
}

/** A new map without `value` on the vertical's list; an emptied list is dropped. */
export function withoutSubVertical(map, vertical, value) {
  if (!keyOf(vertical)) return map || {};
  const key = mapKey(map, vertical);
  const list = subVerticalsFor(map, vertical).filter(x => keyOf(x) !== keyOf(value));
  const next = { ...(map || {}) };
  if (list.length) next[key] = list; else delete next[key];
  return next;
}

/** A new map with `from` renamed to `to` on the vertical's list, in place. */
export function renameSubVertical(map, vertical, from, to) {
  const t = clean(to);
  if (!keyOf(vertical) || !t) return map || {};
  const key = mapKey(map, vertical);
  const list = subVerticalsFor(map, vertical);
  // Renaming onto another entry that already exists would make a duplicate.
  if (keyOf(from) !== keyOf(t) && list.some(x => keyOf(x) === keyOf(t))) return map || {};
  if (!list.some(x => keyOf(x) === keyOf(from))) return map || {};
  return { ...(map || {}), [key]: list.map(x => (keyOf(x) === keyOf(from) ? t : x)) };
}

/** Is `value` on the vertical's list? */
export function subVerticalOnList(map, vertical, value) {
  return subVerticalsFor(map, vertical).some(x => keyOf(x) === keyOf(value));
}
