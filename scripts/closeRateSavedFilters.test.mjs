// Assertion tests for Opps > Close Rates saved filters
// (src/utils/closeRateSavedFilters.js). Plain Node. Run:
//   node scripts/closeRateSavedFilters.test.mjs

import assert from 'node:assert/strict';
import {
  readSavedFilters, snapshotFilters, filtersFromEntry, matchesEntry,
  withSaved, withoutSaved, withDefault, SETTINGS_KEY,
  CHART_SETTINGS_KEY, readChartSaved, chartSavedPatch, snapshotChart, chartMatchesEntry, chartFromEntry,
} from '../src/utils/closeRateSavedFilters.js';

const PRESETS = [
  { key: '1y', from: () => '2025-11-04' },
  { key: 'all', from: () => '' },
];

// A preset is saved as the preset, so it re-resolves when applied later.
const onPreset = snapshotFilters({ period: 'month', preset: '1y', from: '2024-01-01', to: '', leadOrHigher: false, noPullThroughs: true }, '  Last year  ', 1);
assert.deepEqual(onPreset, { id: 1, name: 'Last year', period: 'month', preset: '1y', from: '', to: '', leadOrHigher: false, noPullThroughs: true });
assert.deepEqual(filtersFromEntry(onPreset, PRESETS), { period: 'month', preset: '1y', from: '2025-11-04', to: '', leadOrHigher: false, noPullThroughs: true });

// Fixed dates are kept as typed.
const fixed = snapshotFilters({ period: 'year', preset: '', from: '2024-01-01', to: '2024-12-31', leadOrHigher: true, noPullThroughs: false }, 'FY24', 2);
assert.deepEqual(filtersFromEntry(fixed, PRESETS), { period: 'year', preset: '', from: '2024-01-01', to: '2024-12-31', leadOrHigher: true, noPullThroughs: false });

// A preset that no longer exists falls back to stored dates; bad period falls back to quarter.
assert.deepEqual(filtersFromEntry({ period: 'week', preset: 'gone', from: '2023-01-01', to: '' }, PRESETS),
  { period: 'quarter', preset: '', from: '2023-01-01', to: '', leadOrHigher: true, noPullThroughs: true });

// matchesEntry compares what would be saved.
assert.equal(matchesEntry({ period: 'month', preset: '1y', from: '2025-11-04', to: '', leadOrHigher: false, noPullThroughs: true }, onPreset), true);
assert.equal(matchesEntry({ period: 'quarter', preset: '1y', from: '', to: '', leadOrHigher: false, noPullThroughs: true }, onPreset), false);

// Save, replace by name (keeping id and position), star, delete.
let saved = readSavedFilters({});
assert.deepEqual(saved, { list: [], defaultId: null });
saved = withSaved(saved, onPreset);
saved = withSaved(saved, fixed);
saved = withSaved(saved, { ...fixed, id: 99, name: 'last YEAR', period: 'year' });
assert.deepEqual(saved.list.map(e => [e.id, e.name, e.period]), [[1, 'last YEAR', 'year'], [2, 'FY24', 'year']]);
saved = withDefault(saved, 2);
assert.equal(saved.defaultId, 2);
assert.equal(withDefault(saved, 2).defaultId, null);
saved = withoutSaved(saved, 2);
assert.deepEqual(saved, { list: [saved.list[0]], defaultId: null });

// Reading settings drops junk and a dangling default.
assert.deepEqual(readSavedFilters({ [SETTINGS_KEY]: { list: [null, { id: 3, name: ' ' }, { id: 4, name: 'Ok' }], defaultId: 3 } }),
  { list: [{ id: 4, name: 'Ok' }], defaultId: null });

// ---- per chart ----------------------------------------------------------
const chartFilters = { period: 'year', preset: '1y', from: '2025-11-04', to: '', leadOrHigher: true, noPullThroughs: false };
const src = snapshotChart({ filters: chartFilters, off: new Set(['PE partner', 'Inside Sales']) }, 'No partners', 7);
assert.deepEqual(src, {
  id: 7, name: 'No partners',
  filters: { period: 'year', preset: '1y', from: '', to: '', leadOrHigher: true, noPullThroughs: false },
  off: ['Inside Sales', 'PE partner'],
});
// Matching ignores line order; a different line set or filter does not match.
assert.equal(chartMatchesEntry({ filters: chartFilters, off: new Set(['PE partner', 'Inside Sales']) }, src), true);
assert.equal(chartMatchesEntry({ filters: chartFilters, off: new Set(['PE partner']) }, src), false);
assert.equal(chartMatchesEntry({ filters: { ...chartFilters, period: 'month' }, off: new Set(['PE partner', 'Inside Sales']) }, src), false);
// Restoring re-resolves the preset and gives the lines back as a Set.
const back = chartFromEntry(src, PRESETS);
assert.deepEqual(back.filters, { period: 'year', preset: '1y', from: '2025-11-04', to: '', leadOrHigher: true, noPullThroughs: false });
assert.deepEqual([...back.off].sort(), ['Inside Sales', 'PE partner']);
assert.equal(back.reach, null);

// Stage reach also keeps its own Closed only and Start Date range.
const reach = snapshotChart({ filters: chartFilters, off: new Set(['Quoted']), reach: { scope: 'all', from: '2025-01-01', to: '' } }, 'All opps', 8);
assert.deepEqual(reach.reach, { scope: 'all', from: '2025-01-01', to: '' });
assert.deepEqual(chartFromEntry(reach, PRESETS).reach, { scope: 'all', from: '2025-01-01', to: '' });

// Charts are stored side by side; saving one keeps the others.
const settings = { [CHART_SETTINGS_KEY]: { stage: { list: [{ id: 1, name: 'S', filters: {}, off: [] }], defaultId: 1 } } };
const patch = chartSavedPatch(settings, 'source', { list: [src], defaultId: null });
assert.deepEqual(Object.keys(patch[CHART_SETTINGS_KEY]).sort(), ['source', 'stage']);
assert.equal(readChartSaved({ ...settings, ...patch }, 'stage').defaultId, 1);
assert.deepEqual(readChartSaved({ ...settings, ...patch }, 'source').list, [src]);
assert.deepEqual(readChartSaved({}, 'reach'), { list: [], defaultId: null });
// Entries without filters are dropped.
assert.deepEqual(readChartSaved({ [CHART_SETTINGS_KEY]: { source: { list: [{ id: 2, name: 'x' }], defaultId: 2 } } }, 'source'), { list: [], defaultId: null });

console.log('closeRateSavedFilters: ok');

// A rolling Start Date window on Stage reach is saved as its preset key.
{
  const rolling = snapshotChart({ filters: { period: 'quarter', preset: '1y', from: '', to: '', leadOrHigher: true, noPullThroughs: true }, off: new Set(), reach: { scope: 'closed', preset: '24m', from: '2024-11-04', to: '' } }, 'Two years', 9);
  assert.deepEqual(rolling.reach, { scope: 'closed', preset: '24m', from: '', to: '' }, 'no frozen dates');
  assert.deepEqual(chartFromEntry(rolling, PRESETS).reach, { scope: 'closed', preset: '24m', from: '', to: '' });
  console.log('PASS closeRateSavedFilters rolling reach');
}
