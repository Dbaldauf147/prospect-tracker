// Assertion tests for the Prospecting History subtab's record. Plain Node,
// like the rest of scripts/. Run:
//   node scripts/prospectingHistory.test.mjs
//
// The rules worth guarding: progress counts only the unbroken run of clear
// steps from the top, keeps the best reading of the day, and the overdue
// count keeps its first reading while the last one moves.
import {
  historyChartRows, ladderProgress, mergeDay, parseHistory, trimHistory, workingDaysBack,
} from '../src/utils/prospectingHistory.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const steps = [
  { key: 'opps', title: 'Follow up on current opps' },
  { key: 'map', title: 'Map contacts' },
  { key: 'mkt', title: 'Market updates' },
  { key: 'cold', title: 'Cold outreach' },
];
const st = (...states) => states.map((state, i) => ({ key: steps[i].key, state }));

// ---- ladder progress ---------------------------------------------------------
eq(ladderProgress(st('unknown', 'open', 'open', 'open'), steps), null, 'nothing to say while step 1 is loading');
eq(ladderProgress(st('work', 'caught-up', 'open', 'open'), steps),
  { reached: 0, total: 4, nextTitle: 'Follow up on current opps' }, 'step 1 owed: 0 clear, even with a tick below');
eq(ladderProgress(st('caught-up', 'caught-up', 'due', 'caught-up'), steps),
  { reached: 2, total: 4, reachedTitle: 'Map contacts', nextTitle: 'Market updates' }, 'progress stops at the first step not clear');
eq(ladderProgress(st('caught-up', 'caught-up', 'caught-up', 'caught-up'), steps),
  { reached: 4, total: 4, reachedTitle: 'Cold outreach' }, 'whole ladder clear has no next step');
eq(ladderProgress([], steps), null, 'an empty ladder records nothing');

// ---- merging a day -------------------------------------------------------------
const p = (reached) => ({ reached, total: 4, nextTitle: 'x' });
let day = mergeDay(undefined, { progress: p(1), overdue: 5 }, 1);
eq([day.reached, day.overdueStart, day.overdueEnd], [1, 5, 5], 'first reading sets everything');
day = mergeDay(day, { progress: p(3), overdue: 2 }, 2);
eq([day.reached, day.overdueStart, day.overdueEnd], [3, 5, 2], 'progress rises, overdue start stays, end moves');
const same = mergeDay(day, { progress: p(2), overdue: 2 }, 3);
eq(same === day, true, 'a lower reading later in the day changes nothing');
day = mergeDay(day, { progress: null, overdue: 0 }, 4);
eq([day.reached, day.overdueEnd, day.updatedAt], [3, 0, 4], 'overdue alone still updates the end of day');
eq(mergeDay(undefined, { progress: null, overdue: null }), {}, 'no reading leaves an empty row');

// ---- storage helpers -----------------------------------------------------------
eq(parseHistory('not json'), {}, 'a corrupt payload reads as no history');
eq(parseHistory('[1]'), {}, 'an array payload reads as no history');
eq(Object.keys(trimHistory({ '2026-01-01': {}, '2026-01-02': {}, '2026-01-03': {} }, 2)), ['2026-01-02', '2026-01-03'], 'trimming drops the oldest days');

// ---- the chart axis ------------------------------------------------------------
// 2026-10-05 is a Monday.
eq(workingDaysBack('2026-10-05', 3), ['2026-10-01', '2026-10-02', '2026-10-05'], 'weekends are skipped');
eq(workingDaysBack('2026-10-05', 2, { '2026-10-04': { reached: 1 } }), ['2026-10-02', '2026-10-04', '2026-10-05'], 'a recorded weekend day is kept');
const rows = historyChartRows({ '2026-10-05': { reached: 2, total: 4, overdueStart: 3, overdueEnd: 1 } }, ['2026-10-02', '2026-10-05']);
eq(rows.map(r => [r.recorded, r.reached, r.overdueStart, r.overdueEnd]), [[false, null, null, null], [true, 2, 3, 1]], 'unrecorded days are gaps, not zeros');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
