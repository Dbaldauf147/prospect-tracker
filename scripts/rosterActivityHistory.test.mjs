// The day-by-day record behind Prospecting History's "Contacts with
// activity" line charts (utils/rosterActivityHistory). Plain Node. Run:
//   node scripts/rosterActivityHistory.test.mjs
import assert from 'node:assert/strict';
import { readingFromRosterCounts, withRosterActivityReading, rosterActivityChartRows } from '../src/utils/rosterActivityHistory.js';

const counts = (kt = 26) => [
  { key: 'keyTarget', label: 'Dan Key Target', total: 76, windows: [{ days: 30, active: kt }, { days: 60, active: 36 }, { days: 120, active: 37 }] },
  { key: 'keyProspect', label: 'Dan Key Prospect', total: 29, windows: [{ days: 30, active: 4 }, { days: 60, active: 4 }, { days: 120, active: 5 }] },
  { key: 'decisionMakers', label: 'Decision Makers', total: 172, windows: [{ days: 30, active: 55 }, { days: 60, active: 70 }, { days: 120, active: 86 }] },
];

const r = readingFromRosterCounts(counts());
assert.deepEqual(r.rosters.keyTarget, { label: 'Dan Key Target', total: 76, active: { 30: 26, 60: 36, 120: 37 } });
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
assert.deepEqual(rows.map(x => [x.iso, x.recorded, x.w30, x.w60, x.w120, x.total]), [
  ['2026-10-14', true, 20, 36, 37, 76],
  ['2026-10-15', false, null, null, null, null],
  ['2026-10-16', true, 30, 36, 37, 76],
]);
assert.equal(rosterActivityChartRows(h3, ['2026-10-16'], 'nobody')[0].recorded, false);

console.log('rosterActivityHistory: all assertions passed');
