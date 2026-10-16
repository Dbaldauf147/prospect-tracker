// The day-by-day record behind Prospecting History's "Contacts with
// activity" line charts (utils/rosterActivityHistory). Plain Node. Run:
//   node scripts/rosterActivityHistory.test.mjs
import assert from 'node:assert/strict';
import { readingFromRosterCounts, withRosterActivityReading, rosterActivityChartRows } from '../src/utils/rosterActivityHistory.js';

const counts = (kt = 26) => [
  { key: 'keyTarget', label: 'Dan Key Target', total: 76, windows: [{ days: 30, active: kt }, { days: 60, active: 36 }, { days: 90, active: 37 }, { days: 120, active: 38 }] },
  { key: 'keyProspect', label: 'Dan Key Prospect', total: 29, windows: [{ days: 30, active: 4 }, { days: 60, active: 4 }, { days: 90, active: 5 }, { days: 120, active: 5 }] },
  { key: 'decisionMakers', label: 'Decision Makers', total: 172, windows: [{ days: 30, active: 55 }, { days: 60, active: 70 }, { days: 90, active: 80 }, { days: 120, active: 86 }] },
];

const r = readingFromRosterCounts(counts());
assert.deepEqual(r.rosters.keyTarget, { label: 'Dan Key Target', total: 76, active: { 30: 26, 60: 36, 90: 37, 120: 38 } });
assert.equal(Object.keys(r.rosters).length, 3);
// Not real yet: nothing, a missing window, or every roster empty.
assert.equal(readingFromRosterCounts(null), null);
assert.equal(readingFromRosterCounts([{ key: 'k', label: 'K', total: 3, windows: [{ days: 30, active: 1 }] }]), null, 'a missing window is no reading');
assert.equal(readingFromRosterCounts(counts().map(c => ({ ...c, total: 0, windows: c.windows.map(w => ({ ...w, active: 0 })) }))), null, 'all empty is no reading');

// The latest reading of a day wins; an unchanged one writes nothing.
const h1 = withRosterActivityReading({}, '2026-10-16', r, 100);
assert.equal(h1['2026-10-16'].at, 100);
assert.equal(withRosterActivityReading(h1, '2026-10-16', readingFromRosterCounts(counts()), 200), h1, 'same numbers: same object');
const h2 = withRosterActivityReading(h1, '2026-10-16', readingFromRosterCounts(counts(30)), 300);
assert.equal(h2['2026-10-16'].rosters.keyTarget.active[30], 30);
assert.equal(h2['2026-10-16'].at, 300);

// Chart rows: one per axis day, null (a break in the line) where unrecorded.
const h3 = withRosterActivityReading(h2, '2026-10-14', readingFromRosterCounts(counts(20)), 50);
const rows = rosterActivityChartRows(h3, ['2026-10-14', '2026-10-15', '2026-10-16'], 'keyTarget');
assert.deepEqual(rows.map(x => [x.iso, x.recorded, x.w30, x.w60, x.w90, x.w120, x.total]), [
  ['2026-10-14', true, 20, 36, 37, 38, 76],
  ['2026-10-15', false, null, null, null, null, null],
  ['2026-10-16', true, 30, 36, 37, 38, 76],
]);
// The shares the charts draw: % of the list per window, and % with none in 120.
assert.deepEqual([rows[2].p30, rows[2].p90, rows[2].p120, rows[2].pNone], [39.5, 48.7, 50, 50]);
assert.deepEqual([rows[1].p30, rows[1].p90, rows[1].p120, rows[1].pNone], [null, null, null, null], 'unrecorded: a break');
// A day recorded before 90 days was tracked: that window alone is missing.
const old = { '2026-10-16': { rosters: { keyTarget: { label: 'K', total: 79, active: { 30: 28, 60: 38, 120: 39 } } } } };
const o = rosterActivityChartRows(old, ['2026-10-16'], 'keyTarget')[0];
assert.deepEqual([o.p30, o.p90, o.p120, o.pNone], [35.4, null, 49.4, 50.6]);
assert.equal(rosterActivityChartRows(h3, ['2026-10-16'], 'nobody')[0].recorded, false);

console.log('rosterActivityHistory: all assertions passed');
