// Assertion tests for Opps > Close Rates saved filters
// (src/utils/closeRateSavedFilters.js). Plain Node. Run:
//   node scripts/closeRateSavedFilters.test.mjs

import assert from 'node:assert/strict';
import {
  readSavedFilters, snapshotFilters, filtersFromEntry, matchesEntry,
  withSaved, withoutSaved, withDefault, SETTINGS_KEY,
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

console.log('closeRateSavedFilters: ok');
