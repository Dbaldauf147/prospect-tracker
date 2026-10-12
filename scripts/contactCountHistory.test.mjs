// The weekly contact-count log behind Contacts > History.
//
// Run: node scripts/contactCountHistory.test.mjs
import {
  countsFromCoverage, withWeekCounts, countHistoryRows, countChanges, MAX_WEEKS,
} from '../src/utils/contactCountHistory.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ---- the reading ---------------------------------------------------------------
const coverage = { key: { contacts: 42 }, active: { contacts: 9 }, client: { contacts: 17 }, keyProspect: { contacts: 8 }, all: { contacts: 70 } };
eq(countsFromCoverage(coverage), { key: 42, client: 17, keyProspect: 8 }, 'a reading is the three roster counts');
eq(countsFromCoverage(null), null, 'no coverage, no reading');
eq(countsFromCoverage({ key: { contacts: 1 }, client: { contacts: 2 } }), null, 'a roster missing means no reading, not a 0');

// ---- recording -----------------------------------------------------------------
const h1 = withWeekCounts({}, '2026-10-05', { key: 40, client: 15, keyProspect: 7 }, 1);
eq(h1['2026-10-05'], { key: 40, client: 15, keyProspect: 7, at: 1 }, 'a week is written with when it was read');
eq(withWeekCounts(h1, '2026-10-05', { key: 40, client: 15, keyProspect: 7 }, 2) === h1, true, 'an unchanged reading writes nothing');
eq(withWeekCounts(h1, '2026-10-05', { key: 41, client: 15, keyProspect: 7 }, 3)['2026-10-05'].key, 41, 'the latest reading in a week wins');
let big = {};
for (let i = 0; i < MAX_WEEKS + 5; i += 1) big = withWeekCounts(big, `2020-${String(i).padStart(4, '0')}`, { key: i, client: 0, keyProspect: 0 });
eq([Object.keys(big).length, Object.keys(big).sort()[0]], [MAX_WEEKS, '2020-0005'], 'the oldest weeks drop past the cap');

// ---- the chart -------------------------------------------------------------------
// 2026-10-12 is a Monday.
const history = {
  '2026-09-21': { key: 38, client: 15, keyProspect: 9, at: 1 },
  '2026-10-05': { key: 40, client: 15, keyProspect: 7, at: 2 },
  '2026-10-12': { key: 44, client: 16, keyProspect: 7, at: 3 },
};
const rows = countHistoryRows(history, '2026-10-12', 4);
eq(rows.map(r => r.week), ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'], 'one row per Monday, oldest first');
eq(rows.map(r => r.key), [38, null, 40, 44], 'a week with no reading is a gap, not a 0');
eq(rows[1].recorded, false, 'and is marked unrecorded');
// Across the November daylight-saving change the weeks stay on Mondays.
eq(countHistoryRows({}, '2026-11-09', 3).map(r => r.week), ['2026-10-26', '2026-11-02', '2026-11-09'], 'weeks stay on Mondays across a clock change');

const ch = countChanges(rows);
eq(ch.key, { from: 38, to: 44, since: 'Sep 21', delta: 6 }, 'the change runs from the first recorded week to the last');
eq(ch.keyProspect.delta, -2, 'a roster that shrank reads negative');
eq(countChanges(countHistoryRows({ '2026-10-12': history['2026-10-12'] }, '2026-10-12', 4)).key, null, 'one reading has no change yet');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
