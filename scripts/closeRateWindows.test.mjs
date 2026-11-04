// Close Rates rolling windows.
import assert from 'node:assert/strict';
import { WINDOW_PRESETS, presetFrom, PRESET_LIST, cleanWeeklyMonths } from '../src/utils/closeRateWindows.js';

const now = new Date(2026, 10, 4); // 4 Nov 2026
assert.equal(presetFrom('6m', now), '2026-05-04');
assert.equal(presetFrom('1y', now), '2025-11-04');
assert.equal(presetFrom('18m', now), '2025-05-04');
assert.equal(presetFrom('24m', now), '2024-11-04');
assert.equal(presetFrom('36m', now), '2023-11-04');
assert.equal(presetFrom('2y', now), '2024-01-01');
assert.equal(presetFrom('ytd', now), '2026-01-01');
assert.equal(presetFrom('all', now), '');
assert.equal(presetFrom('nope', now), null);
assert.equal(presetFrom('6m', new Date(2026, 7, 31)), '2026-02-28', 'month end clamps');
assert.equal(presetFrom('1y', new Date(2028, 1, 29)), '2027-02-28', 'leap day clamps');
assert.equal(new Set(WINDOW_PRESETS.map(p => p.key)).size, WINDOW_PRESETS.length, 'keys unique');
assert.ok(['1y', '2y', 'ytd', 'all'].every(k => WINDOW_PRESETS.some(p => p.key === k)), 'saved-filter keys still exist');
assert.equal(typeof PRESET_LIST[0].from(), 'string');
assert.equal(cleanWeeklyMonths(12), 12);
assert.equal(cleanWeeklyMonths('9'), 9);
assert.equal(cleanWeeklyMonths(7), 6);
assert.equal(cleanWeeklyMonths(undefined), 6);
console.log('PASS closeRateWindows');
