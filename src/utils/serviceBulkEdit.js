// Bulk edit on Dropdowns > Services: one field set to one value across
// every service the table is showing. Built as a single settings update so
// a change to forty services is one write (and one undo-able sync), not
// forty racing each other.

import { getServiceCategories, moveServiceToBucket } from './serviceCategoriesStore.js';

// The fields the bulk editor offers, in table order. The three
// service-list fields (Dependent Rollout, Auto-add, Auto-N/A) are left to
// the row editors: one shared list of other services rarely suits a batch.
export const BULK_SERVICE_FIELDS = [
  { key: 'serviceBucket', label: 'Service Bucket', kind: 'bucket' },
  { key: 'bfoTag', label: 'BFO Tag / Local Project Name' },
  { key: 'region', label: 'Region' },
  { key: 'years', label: 'Years' },
  { key: 'productLine', label: 'Product Line' },
  { key: 'serviceType', label: 'Service Type' },
  { key: 'timelineDriven', label: 'Timeline Driven', kind: 'yesno' },
  { key: 'rolloutTime', label: 'Rollout Time (weeks)', kind: 'weeks' },
  { key: 'sme', label: 'SME' },
  { key: 'ktm', label: 'KTM' },
  { key: 'contactTags', label: 'Contact Tags' },
  { key: 'hidden', label: 'Hidden', kind: 'hidden' },
];

/**
 * Settings updates that set `field` to `value` on every service in
 * `names`. A blank value clears the field (it falls back to the catalog),
 * the same as clearing a single cell. Returns null when nothing would
 * change, or the value isn't usable (a week count that isn't a number).
 */
export function bulkServiceUpdates(settings, names, field, value) {
  const list = [...new Set((names || []).filter(Boolean))];
  if (!list.length) return null;
  const v = String(value ?? '').trim();

  if (field === 'serviceBucket') {
    let layout = getServiceCategories(settings);
    let moved = false;
    for (const name of list) {
      const next = moveServiceToBucket(layout, name, v, settings?.serviceRenames);
      if (next) { layout = next; moved = true; }
    }
    return moved ? { customServiceCategories: layout } : null;
  }

  if (field === 'hidden') {
    const current = settings?.hiddenServices || [];
    const set = new Set(current);
    if (v === 'Hidden') list.forEach(n => set.add(n));
    else if (v === 'Shown') list.forEach(n => set.delete(n));
    else return null;
    if (set.size === current.length && current.every(n => set.has(n))) return null;
    return { hiddenServices: [...set] };
  }

  if (!BULK_SERVICE_FIELDS.some(f => f.key === field)) return null;
  let stored = v;
  if (field === 'rolloutTime' && v !== '') {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    stored = String(n);
  }
  const overrides = { ...(settings?.serviceOverrides || {}) };
  let changed = false;
  for (const name of list) {
    const row = { ...(overrides[name] || {}) };
    if (stored === '') {
      if (!(field in row)) continue;
      delete row[field];
    } else {
      if (row[field] === stored) continue;
      row[field] = stored;
    }
    changed = true;
    if (Object.keys(row).length === 0) delete overrides[name];
    else overrides[name] = row;
  }
  return changed ? { serviceOverrides: overrides } : null;
}
