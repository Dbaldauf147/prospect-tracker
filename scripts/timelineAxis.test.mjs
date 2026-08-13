// Assertion tests for the Implementation chart's axis granularity. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/timelineAxis.test.mjs
//
// The month band can be read week by week or month by month. Rather than
// give the SVG and the Excel a second code path each, the switch lives in
// timelineWeekTicks: a monthly axis returns ONE tick per month spanning the
// whole column. Every "which tick does this fraction land in" calculation
// downstream keeps working unchanged and simply finds one tick to land in.
//
// So what has to hold is the tick contract itself: the spans still tile each
// month from 0 to 1 with no gaps and no overlaps, and the count is what each
// renderer sizes its grid from.
import { timelineWeekTicks, flattenWeekTicks } from '../src/utils/timelineDates.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}

// --- weekly is what it always was -----------------------------------------
const weekly = timelineWeekTicks('2026-08', 3, true);
check('three months of ticks', weekly.length, 3);
check('August 2026 splits into weeks', weekly[0].weeks.length > 1, true);
check('and the default is weekly', JSON.stringify(timelineWeekTicks('2026-08', 3, true, true)), JSON.stringify(weekly));

// --- monthly collapses each month to one span -----------------------------
const monthly = timelineWeekTicks('2026-08', 3, true, false);
check('still one entry per month', monthly.length, 3);
same('each month is a single span covering its whole column',
  monthly.map(m => m.weeks), [
    [{ label: '', from: 0, to: 1 }],
    [{ label: '', from: 0, to: 1 }],
    [{ label: '', from: 0, to: 1 }],
  ]);
// Unlabelled on purpose: a month column already carries its own label in the
// band above, and a number under it would read as a week.
check('the span carries no label of its own', monthly[0].weeks[0].label, '');

// --- the flattened column series is what the Excel grid is built from -----
check('weekly flattens to many columns', flattenWeekTicks(weekly).length > 3, true);
check('monthly flattens to one column per month', flattenWeekTicks(monthly).length, 3);
same('each of which is both the first and last of its month',
  flattenWeekTicks(monthly).map(c => [c.month, c.first, c.last]),
  [[1, true, true], [2, true, true], [3, true, true]]);

// --- the spans tile their column, whichever granularity ------------------
// A gap or an overlap here puts a bar's edge in the wrong place, so it's
// worth asserting rather than eyeballing.
function tiles(ticks) {
  return ticks.every(({ weeks }) => {
    if (weeks[0].from !== 0) return false;
    if (weeks[weeks.length - 1].to !== 1) return false;
    return weeks.every((w, i) => i === 0 || Math.abs(w.from - weeks[i - 1].to) < 1e-9);
  });
}
check('weekly spans tile each month', tiles(weekly), true);
check('monthly spans tile each month', tiles(monthly), true);

// A relative (non-calendar) timeline has no real weeks to split on, and the
// monthly axis has to behave the same way there.
const relative = timelineWeekTicks('', 2, false, false);
same('a relative timeline collapses too',
  relative.map(m => m.weeks.length), [1, 1]);
check('while its weekly form keeps four per month',
  timelineWeekTicks('', 2, false, true)[0].weeks.length, 4);

// --- degenerate inputs ----------------------------------------------------
check('a zero month count still yields one month', timelineWeekTicks('2026-08', 0, true, false).length, 1);
check('and so does a negative one', timelineWeekTicks('2026-08', -3, true, false).length, 1);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
