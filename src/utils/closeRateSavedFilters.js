// Saved filters for Opps > Close Rates.
//
// A saved filter is the tab's top controls: Period, the Close Date window
// (a preset or a fixed From / To) and the two filter buttons. They live in
// settings.closeRateSavedFilters, so they follow the user to every machine:
//
//   { list: [{ id, name, period, preset, from, to, leadOrHigher, noPullThroughs }],
//     defaultId }   // the one the tab opens with, or null
//
// A filter saved on a preset keeps the preset, not the dates it resolved to,
// so "Last 12 months" saved in May still means the last 12 months in
// November. Pure, so scripts/closeRateSavedFilters.test.mjs can check it.

export const SETTINGS_KEY = 'closeRateSavedFilters';

const PERIOD_KEYS = new Set(['month', 'quarter', 'year']);

// The stored value, cleaned: a list of well-formed entries and a defaultId
// that points at one of them (or null).
export function readSavedFilters(settings) {
  const raw = settings?.[SETTINGS_KEY];
  const list = Array.isArray(raw?.list)
    ? raw.list.filter(e => e && e.id != null && String(e.name || '').trim())
    : [];
  const defaultId = list.some(e => e.id === raw?.defaultId) ? raw.defaultId : null;
  return { list, defaultId };
}

// The filter state the tab is showing, as an entry to store.
export function snapshotFilters(state, name, id = Date.now()) {
  return {
    id,
    name: String(name || '').trim(),
    period: PERIOD_KEYS.has(state.period) ? state.period : 'quarter',
    preset: state.preset || '',
    from: state.preset ? '' : (state.from || ''),
    to: state.preset ? '' : (state.to || ''),
    leadOrHigher: !!state.leadOrHigher,
    noPullThroughs: !!state.noPullThroughs,
  };
}

// The tab state an entry restores. `presets` is the tab's preset list
// ({ key, from() }); an entry whose preset no longer exists falls back to
// its stored dates.
export function filtersFromEntry(entry, presets) {
  const p = entry.preset ? presets.find(x => x.key === entry.preset) : null;
  return {
    period: PERIOD_KEYS.has(entry.period) ? entry.period : 'quarter',
    preset: p ? p.key : '',
    from: p ? p.from() : (entry.from || ''),
    to: p ? '' : (entry.to || ''),
    leadOrHigher: entry.leadOrHigher !== false,
    noPullThroughs: entry.noPullThroughs !== false,
  };
}

// Does the tab's current state match a saved entry?
export function matchesEntry(state, entry) {
  const a = snapshotFilters(state, 'x', 0);
  const b = snapshotFilters(entry, 'x', 0);
  return JSON.stringify(a) === JSON.stringify(b);
}

// Add a new entry, or replace the one with the same name (case-insensitive),
// keeping its id and its place in the list.
export function withSaved(saved, entry) {
  const key = entry.name.toLowerCase();
  const at = saved.list.findIndex(e => String(e.name).trim().toLowerCase() === key);
  if (at === -1) return { ...saved, list: [...saved.list, entry] };
  const list = saved.list.slice();
  list[at] = { ...entry, id: saved.list[at].id };
  return { ...saved, list };
}

export function withoutSaved(saved, id) {
  return {
    list: saved.list.filter(e => e.id !== id),
    defaultId: saved.defaultId === id ? null : saved.defaultId,
  };
}

// Star / unstar the entry the tab opens with.
export function withDefault(saved, id) {
  return { ...saved, defaultId: saved.defaultId === id ? null : id };
}
