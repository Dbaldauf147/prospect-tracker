// Assertion tests for the shared date picker's calendar grid. Plain Node —
// no test framework (the project has none). Run:
//   node scripts/monthGrid.test.mjs
//
// The grid fills its top and bottom gaps with the neighbouring months' days,
// so the off-by-ones worth holding are the ones at the seams: a month that
// starts on a Sunday must not grow a phantom leading week, and December /
// January have to roll the year with them.
import { buildMonthGrid, daysInMonth, shiftMonth } from '../src/utils/monthGrid.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}
const cell = (c) => `${c.y}-${c.m + 1}-${c.d}${c.outside ? '*' : ''}`;

// --- month arithmetic ------------------------------------------------------

check('february 2024 is a leap february', daysInMonth(2024, 1), 29);
check('february 2025 is not', daysInMonth(2025, 1), 28);
same('a month before january is last december', shiftMonth(2025, 0, -1), { y: 2024, m: 11 });
same('a month after december is next january', shiftMonth(2025, 11, 1), { y: 2026, m: 0 });

// --- the grid --------------------------------------------------------------

// August 2025: starts Friday, 31 days.
const aug = buildMonthGrid(2025, 7);
check('the grid is always six weeks', aug.length, 42);
check('it opens on the previous month', cell(aug[0]), '2025-7-27*');
check('the 1st lands on its weekday', cell(aug[5]), '2025-8-1');
check('the last day of the month is in place', cell(aug[35]), '2025-8-31');
// The ask this came from: the first days of September without paging.
same('it runs on into the next month',
  aug.slice(36).map(cell),
  ['2025-9-1*', '2025-9-2*', '2025-9-3*', '2025-9-4*', '2025-9-5*', '2025-9-6*']);
check('every day of the month is present', aug.filter(c => !c.outside).length, 31);

// June 2025 starts on a Sunday — no leading days, and the fill is all at the
// end. A grid that padded a whole blank week here would push the 1st down a row.
const jun = buildMonthGrid(2025, 5);
check('a month starting Sunday starts at its 1st', cell(jun[0]), '2025-6-1');
check('and fills twelve days at the end', jun.filter(c => c.outside).length, 12);
check('which are next month, in order', cell(jun[41]), '2025-7-12*');

// February 2021: starts Monday, 28 days — the case a five-week grid would
// leave a row short of the fixed popup height.
const feb = buildMonthGrid(2021, 1);
check('a short february still fills six weeks', feb.length, 42);
check('it opens on the last day of january', cell(feb[0]), '2021-1-31*');

// Year seams.
check('december rolls forward into january', cell(buildMonthGrid(2025, 11)[41]), '2026-1-10*');
check('january rolls back into december', cell(buildMonthGrid(2026, 0)[0]), '2025-12-28*');

console.log(failures === 0 ? '\nAll monthGrid tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
