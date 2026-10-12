// Assertion tests for the Prospecting History subtab's Tiered Activity
// record. Plain Node, like the rest of scripts/. Run:
//   node scripts/tieredCoverageHistory.test.mjs
//
// The rules worth guarding: a reading needs every tier, the latest reading
// of a day wins, an unchanged reading is not a write, and the chart turns
// counts into whole percentages with a gap for unrecorded days.
import {
  coverageChartRows, parseCoverageHistory, readingFromCoverage, withDayReading,
} from '../src/utils/tieredCoverageHistory.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const coverage = [
  { tier: 'Tier 1', total: 8, active: 6, pct: 75 },
  { tier: 'Tier 2', total: 3, active: 1, pct: 33 },
  { tier: 'Tier 3', total: 0, active: 0, pct: null },
];
const reading = readingFromCoverage(coverage, 60);
eq(reading, { tiers: { 'Tier 1': { active: 6, total: 8 }, 'Tier 2': { active: 1, total: 3 }, 'Tier 3': { active: 0, total: 0 } }, windowDays: 60 }, 'reading off the tiles');
eq(readingFromCoverage(coverage.slice(0, 2), 60), null, 'a missing tier is no reading');
eq(readingFromCoverage(null, 60), null, 'no coverage is no reading');

const h1 = withDayReading({}, '2026-10-12', reading, 1);
eq(h1['2026-10-12'].at, 1, 'first reading recorded');
eq(withDayReading(h1, '2026-10-12', reading, 2) === h1, true, 'same reading again is not a write');
const later = readingFromCoverage([{ ...coverage[0], active: 7 }, coverage[1], coverage[2]], 60);
const h2 = withDayReading(h1, '2026-10-12', later, 3);
eq(h2['2026-10-12'].tiers['Tier 1'].active, 7, 'latest reading of the day wins');
eq(withDayReading(h1, '2026-10-12', readingFromCoverage(coverage, 30), 4)['2026-10-12'].windowDays, 30, 'a window change is a new reading');

const rows = coverageChartRows(h2, ['2026-10-09', '2026-10-12']);
eq(rows[0], { iso: '2026-10-09', recorded: false, windowDays: null, 'Tier 1': null, 'Tier 1 counts': null, 'Tier 2': null, 'Tier 2 counts': null, 'Tier 3': null, 'Tier 3 counts': null }, 'unrecorded day is a gap');
eq([rows[1]['Tier 1'], rows[1]['Tier 2'], rows[1]['Tier 3']], [88, 33, null], 'whole percentages, null for an empty tier');
eq(parseCoverageHistory('not json'), {}, 'corrupt value reads as empty');
eq(parseCoverageHistory('[1]'), {}, 'array reads as empty');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
