// The dropdowns on the service popup's free-text fields (Region, Years, SME,
// …), and the edits the user makes to them.
//
// A field's menu is what the services already say — every value any service
// carries for it, seed catalog and overrides alike — plus whatever the user
// added by hand before any service used it, minus whatever they took off the
// menu. A value typed on the Services table shows up in the popup without a
// second step; a value picked or typed in the popup is also stored on the
// menu (with the one it replaced), so it outlives the service that used it.
//
// Stored under settings.serviceFieldOptions as
//   { [field]: { added: string[], removed: string[] } }
//
// Removing an option only takes it off the menu. The services that carry it
// keep it (the picker always offers the current value), because clearing a
// seed value isn't something a blank override can do, and quietly rewriting
// a dozen services from a menu editor is not what "remove" reads as.
// Renaming is the edit that does reach the services: every one carrying the
// old value is rewritten to the new one, so the menu and the data agree.

import { buildServiceRows } from './serviceRows.js';

// The popup fields that pick from a menu, in popup order.
export const SERVICE_OPTION_FIELDS = ['bfoTag', 'region', 'years', 'serviceType', 'productLine', 'sme', 'ktm'];

const norm = (v) => String(v ?? '').trim();
const keyOf = (v) => norm(v).toLowerCase();

function storeOf(settings) {
  const s = settings?.serviceFieldOptions;
  return (s && typeof s === 'object') ? s : {};
}

function entryOf(settings, field) {
  const e = storeOf(settings)[field];
  return {
    added: Array.isArray(e?.added) ? e.added.map(norm).filter(Boolean) : [],
    removed: Array.isArray(e?.removed) ? e.removed.map(norm).filter(Boolean) : [],
  };
}

function withEntry(settings, field, entry) {
  return { serviceFieldOptions: { ...storeOf(settings), [field]: entry } };
}

// The seed placeholder for "no tag" is a bare hyphen; it isn't a choice.
const isBlank = (v) => !norm(v) || norm(v) === '-';

/**
 * Every field's menu: { [field]: [{ value, count }] }, sorted A-Z, where
 * `count` is how many services carry the value. One pass over the rows for
 * all fields, since the popup draws them all at once.
 */
export function serviceFieldOptions(settings, rows = buildServiceRows(settings)) {
  const out = {};
  for (const field of SERVICE_OPTION_FIELDS) {
    const { added, removed } = entryOf(settings, field);
    const gone = new Set(removed.map(keyOf));
    const byKey = new Map();
    const put = (value, n) => {
      if (isBlank(value) || gone.has(keyOf(value))) return;
      const k = keyOf(value);
      const cur = byKey.get(k);
      if (cur) cur.count += n;
      else byKey.set(k, { value: norm(value), count: n });
    };
    for (const r of rows) put(r.meta?.[field], 1);
    for (const a of added) put(a, 0);
    out[field] = [...byKey.values()]
      .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: 'base' }));
  }
  return out;
}

/**
 * Put `value` on a field's menu. Returns the settings updates, or null when
 * it is blank or already there.
 */
export function addServiceFieldOption(settings, field, value) {
  const v = norm(value);
  if (isBlank(v)) return null;
  const { added, removed } = entryOf(settings, field);
  const k = keyOf(v);
  const wasRemoved = removed.some(r => keyOf(r) === k);
  // Stored even when a service already carries it, so it stays on the menu
  // after that service moves on to something else.
  if (added.some(a => keyOf(a) === k) && !wasRemoved) return null;
  return withEntry(settings, field, {
    added: added.some(a => keyOf(a) === k) ? added : [...added, v],
    removed: removed.filter(r => keyOf(r) !== k),
  });
}

/**
 * Take `value` off a field's menu. Services that carry it keep it.
 */
export function removeServiceFieldOption(settings, field, value) {
  const v = norm(value);
  if (!v) return null;
  const { added, removed } = entryOf(settings, field);
  const k = keyOf(v);
  return withEntry(settings, field, {
    added: added.filter(a => keyOf(a) !== k),
    removed: removed.some(r => keyOf(r) === k) ? removed : [...removed, v],
  });
}

/**
 * Rename an option: the menu entry and every service carrying the old value.
 * Returns the settings updates, or null when nothing would change. Renaming
 * onto a value already on the menu merges the two.
 */
export function renameServiceFieldOption(settings, field, from, to) {
  const oldV = norm(from);
  const newV = norm(to);
  if (!oldV || isBlank(newV) || oldV === newV) return null;
  const oldK = keyOf(oldV);
  const newK = keyOf(newV);

  const overrides = (settings?.serviceOverrides && typeof settings.serviceOverrides === 'object')
    ? settings.serviceOverrides
    : {};
  const nextOverrides = { ...overrides };
  const overrideKeys = Object.keys(overrides);
  let touched = 0;
  for (const r of buildServiceRows(settings)) {
    if (keyOf(r.meta?.[field]) !== oldK) continue;
    // Write under whatever casing the override is already stored under, so
    // the row doesn't end up with two.
    const stored = overrideKeys.find(k => k.toLowerCase() === r.name.toLowerCase()) || r.name;
    nextOverrides[stored] = { ...(overrides[stored] || {}), [field]: newV };
    touched += 1;
  }

  const { added, removed } = entryOf(settings, field);
  const nextAdded = added
    .map(a => (keyOf(a) === oldK ? newV : a))
    .filter((a, i, arr) => arr.findIndex(b => keyOf(b) === keyOf(a)) === i);
  // The new name is wanted on the menu, even if it was taken off before.
  const nextRemoved = removed.filter(r => keyOf(r) !== newK);
  if (touched === 0 && !added.some(a => keyOf(a) === oldK)) return null;

  const updates = withEntry(settings, field, { added: nextAdded, removed: nextRemoved });
  if (touched) updates.serviceOverrides = nextOverrides;
  return updates;
}

/**
 * The popup's one edit callback, (kind, field, a, b), as settings updates.
 * Pass it to updateSettings in its function form so it reads the latest
 * settings rather than the ones the popup rendered with.
 */
export function serviceFieldOptionUpdates(settings, kind, field, a, b) {
  if (!SERVICE_OPTION_FIELDS.includes(field)) return null;
  if (kind === 'add') return addServiceFieldOption(settings, field, a);
  if (kind === 'remove') return removeServiceFieldOption(settings, field, a);
  if (kind === 'rename') return renameServiceFieldOption(settings, field, a, b);
  return null;
}
