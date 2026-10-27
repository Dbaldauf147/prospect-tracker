// Column presets: named views of a table the user saves and switches
// between with one click. "Dan's column formatting" (see CLAUDE.md) is
// width, star, show/hide, order and these.
//
// A preset is { id, name, cols, order }:
//   cols  - the keys that show when it's applied; everything else hides.
//   order - the full column order at the moment it was saved, so a view
//           built around "Company, Sites, Savings" comes back in that order.
//
// Stored per table at settings.tablePrefs[tableId].presets (and a local
// copy for the first paint), through useColumnPresets. These are the pure
// rules, so DataTable and the tables that draw their own markup agree on
// what a preset means.

export const MAX_PRESETS = 20;
export const MAX_PRESET_NAME = 40;

function keyList(v) {
  return Array.isArray(v) ? v.filter(k => typeof k === 'string' && k) : [];
}

// Whatever was stored, as a clean list. A bad entry is dropped rather than
// crashing the table that reads it.
export function sanitizePresets(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const name = String(p.name || '').trim().slice(0, MAX_PRESET_NAME);
    const id = String(p.id || '').trim();
    if (!name || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, cols: keyList(p.cols), order: keyList(p.order) });
    if (out.length >= MAX_PRESETS) break;
  }
  return out;
}

// A new preset from what the table is showing right now. Saving under a
// name that already exists replaces that preset (same id, so it keeps its
// place in the list) rather than making a second one with the same label.
export function savePreset(presets, { name, cols, order, now = Date.now() }) {
  const clean = String(name || '').trim().slice(0, MAX_PRESET_NAME);
  if (!clean) return presets;
  const list = sanitizePresets(presets);
  const existing = list.find(p => p.name.toLowerCase() === clean.toLowerCase());
  const preset = {
    id: existing ? existing.id : `p${now.toString(36)}`,
    name: clean,
    cols: keyList([...(cols || [])]),
    order: keyList([...(order || [])]),
  };
  if (existing) return list.map(p => (p.id === existing.id ? preset : p));
  return [...list, preset].slice(-MAX_PRESETS);
}

export function deletePreset(presets, id) {
  return sanitizePresets(presets).filter(p => p.id !== id);
}

// What applying a preset sets the table to: the hidden keys (every current
// column it doesn't list, bar the ones that can't hide) and the order.
// A column added to the table after the preset was saved isn't in it, so it
// hides; it's one tick away, and the view the user saved stays the view.
// The order is the preset's, filtered to columns that still exist, with any
// newer column slotted in after the one it follows by default.
export function applyPreset(preset, { columnKeys, alwaysVisible = [] }) {
  const keys = keyList(columnKeys);
  const show = new Set(keyList(preset?.cols));
  const hidden = keys.filter(k => !show.has(k) && !alwaysVisible.includes(k));
  const saved = keyList(preset?.order).filter((k, i, arr) => keys.includes(k) && arr.indexOf(k) === i);
  const order = saved.length ? [...saved] : null;
  if (order) {
    keys.forEach((k, idx) => {
      if (order.includes(k)) return;
      const prevAt = idx === 0 ? -1 : order.indexOf(keys[idx - 1]);
      order.splice(prevAt + 1, 0, k);
    });
  }
  return { hidden, order };
}

// Is the table showing exactly this preset's columns? Lights up the chip of
// the preset in effect. Order isn't compared: dragging one column after
// applying a view doesn't make it a different set of columns.
export function presetMatches(preset, { visibleKeys, columnKeys, alwaysVisible = [] }) {
  if (!preset) return false;
  const keys = keyList(columnKeys).filter(k => !alwaysVisible.includes(k));
  const visible = new Set(keyList([...(visibleKeys || [])]));
  const show = new Set(keyList(preset.cols));
  return keys.every(k => visible.has(k) === show.has(k));
}
