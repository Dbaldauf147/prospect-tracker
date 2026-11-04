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

// ---- Per-chart saved filters -------------------------------------------
//
// Each chart on the tab (source, service, stage, reach) can run on its own
// filters instead of the tab's, and keeps its own saved sets in
// settings.closeRateChartFilters:
//
//   { [chart]: { list: [entry], defaultId } }
//   entry = { id, name, filters: <snapshotFilters shape, no id/name>,
//             off: [line keys switched off in the legend],
//             reach?: { scope: 'closed' | 'all', from, to } }  // Stage reach only

export const CHART_SETTINGS_KEY = 'closeRateChartFilters';
export const CHART_IDS = ['source', 'service', 'stage', 'reach'];

const filtersOnly = (state) => {
  const { id: _id, name: _name, ...rest } = snapshotFilters(state, 'x', 0);
  return rest;
};

export function readChartSaved(settings, chart) {
  const raw = settings?.[CHART_SETTINGS_KEY]?.[chart];
  const list = Array.isArray(raw?.list)
    ? raw.list.filter(e => e && e.id != null && String(e.name || '').trim() && e.filters && typeof e.filters === 'object')
    : [];
  const defaultId = list.some(e => e.id === raw?.defaultId) ? raw.defaultId : null;
  return { list, defaultId };
}

// The settings patch that stores `saved` for `chart`, keeping the others.
export function chartSavedPatch(settings, chart, saved) {
  return { [CHART_SETTINGS_KEY]: { ...(settings?.[CHART_SETTINGS_KEY] || {}), [chart]: saved } };
}

const sortedKeys = (off) => [...(off || [])].map(String).sort();
const cleanReach = (reach) => (reach ? {
  scope: reach.scope === 'all' ? 'all' : 'closed',
  from: reach.from || '',
  to: reach.to || '',
} : undefined);

// What a chart is showing, as an entry to store.
export function snapshotChart({ filters, off, reach }, name, id = Date.now()) {
  const entry = { id, name: String(name || '').trim(), filters: filtersOnly(filters), off: sortedKeys(off) };
  const r = cleanReach(reach);
  if (r) entry.reach = r;
  return entry;
}

// Is the chart showing exactly this saved entry?
export function chartMatchesEntry(current, entry) {
  const a = snapshotChart(current, 'x', 0);
  const b = snapshotChart({ filters: entry.filters, off: entry.off, reach: entry.reach }, 'x', 0);
  return JSON.stringify(a) === JSON.stringify(b);
}

// The chart state an entry restores. `presets` as for filtersFromEntry.
export function chartFromEntry(entry, presets) {
  return {
    filters: filtersFromEntry(entry.filters || {}, presets),
    off: new Set(Array.isArray(entry.off) ? entry.off.map(String) : []),
    reach: cleanReach(entry.reach) || null,
  };
}
