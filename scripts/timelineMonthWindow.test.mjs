// Assertion tests for how wide a timeline's month axis is. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/timelineMonthWindow.test.mjs
//
// The Implementation chart's window used to floor at twelve months, so an
// eight-week rollout drew ten empty columns beside it and squeezed the real
// work into the first sliver of the slide. "Auto" now means what the picker
// has always said it means: the plan's own extent, plus one month of tail so
// the last bar isn't flush against the edge.
//
// The part worth pinning hardest is that the extent is derived from the
// template rather than passed in. Callers disagreed on it — the chart knew
// its step placement and passed it, the page had nothing to pass and got
// twelve — so an eighteen-month plan drew eighteen columns while the page
// warned that its last six months were outside the window.
import { resolveMonthWindow, timelineMonthsNeeded } from '../src/utils/timelineDates.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

// A plan positioned by month numbers, the way the proposal decks are.
const byMonths = (...steps) => ({
  positionMode: 'months',
  stages: steps.map(([startMonth, months], i) => ({ id: `s${i}`, name: `Step ${i}`, startMonth, months })),
});

// --- the extent is the last month any step reaches ------------------------
check('a two-month plan needs two months', timelineMonthsNeeded(byMonths([1, 1], [2, 1])), 2);
check('a step spanning past its start counts its span',
  timelineMonthsNeeded(byMonths([1, 1], [2, 3])), 4);
check('an empty template needs nothing', timelineMonthsNeeded({ stages: [] }), 0);

// --- auto is the extent plus one ------------------------------------------
check('the screenshot case: work ending in month 2 draws 3 columns, not 12',
  resolveMonthWindow(byMonths([1, 1], [1, 2], [2, 1], [2, 1], [1, 2]), null).monthCount, 3);
check('a one-month plan draws two columns',
  resolveMonthWindow(byMonths([1, 1]), null).monthCount, 2);
check('a long plan gets its tail month too',
  resolveMonthWindow(byMonths([1, 18]), null).monthCount, 19);

// --- what still wins ------------------------------------------------------
check('a stated month count beats the fit',
  resolveMonthWindow({ ...byMonths([1, 1]), monthCount: 12 }, null).monthCount, 12);
check('a blank template keeps the twelve columns it always opened with',
  resolveMonthWindow({ stages: [] }, null).monthCount, 12);
check('the 36-column cap still holds',
  resolveMonthWindow(byMonths([1, 48]), null).monthCount, 36);

// --- every caller lands on the same window --------------------------------
// The chart passes the extent it computed; the page passes nothing. Before
// the extent was derived here, those two answers differed on any plan longer
// than a year — the chart drew columns the page called out of bounds.
{
  const long = byMonths([1, 18]);
  check('passing the extent and passing nothing agree',
    resolveMonthWindow(long, 18).monthCount, resolveMonthWindow(long, null).monthCount);
  const short = byMonths([1, 1], [2, 1]);
  check('and they agree on a short plan too',
    resolveMonthWindow(short, 2).monthCount, resolveMonthWindow(short, null).monthCount);
}

// --- a declared date range still owns the window --------------------------
{
  const ranged = {
    ...byMonths([1, 1]),
    rangeStart: '2026-01-15',
    rangeEnd: '2026-06-20',
  };
  const w = resolveMonthWindow(ranged, null);
  check('a range sets the months, whatever the steps need', w.monthCount, 6);
  check('and anchors the axis to real calendar months', [w.anchor, w.calendar, w.fromRange],
    ['2026-01', true, true]);
}

console.log(failures ? `${failures} failed.` : 'All passed.');
process.exit(failures ? 1 : 0);
