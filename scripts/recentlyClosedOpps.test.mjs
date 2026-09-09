// Assertion tests for the "closed in the last 7 days" table under New Opps.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/recentlyClosedOpps.test.mjs
//
// Four rules decide this list, and each of them is a way the table could
// quietly say something false:
//
//   1. What "closed" means. Sold and Not Sold, both — a week's losses are
//      as much news as its wins, and a list of only the wins turns a report
//      into a scoreboard. Contracting and Agreement Sent are paperwork on a
//      deal still in flight, not a finished one.
//   2. Where the window's edges are. Counted in whole local days, so the
//      table doesn't change what it shows depending on the hour it was
//      opened, and the boundary day is in rather than out.
//   3. A close dated in the future. It isn't in the past week however it
//      got there, so it stays off — but it must not be mistaken for the
//      undated case, which is a different problem.
//   4. A closed opp with no Close Date. It can't be placed in any week, so
//      it is counted and reported rather than dropped: a Sold deal missing
//      its Close Date is a gap in the record worth seeing.
import {
  closedAgoLabel, daysSinceClose, isClosedStage, recentlyClosedOpps, RECENTLY_CLOSED_DAYS,
} from '../src/utils/recentlyClosedOpps.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// A fixed "now", mid-afternoon, so the day-boundary maths is exercised
// rather than accidentally working because the clock read midnight.
const NOW = new Date(2026, 8, 9, 15, 42).getTime(); // 9 Sep 2026, local
const iso = (d) => `2026-09-${String(d).padStart(2, '0')}`;
const opp = (account, stage, closeDate) => ({
  _id: account, Account: account, Stage: stage, 'Close Date': closeDate,
});
const names = (rows) => rows.map(r => r.Account);

// --- what counts as closed ----------------------------------------------
check('Sold is closed', isClosedStage('Sold'), true);
check('so is Not Sold', isClosedStage('Not Sold'), true);
check('paperwork stages are not — the deal is still in flight',
  ['Contracting', 'Agreement Sent', 'Quoting', 'Lead', ''].map(isClosedStage),
  [false, false, false, false, false]);
check('whitespace and blanks read as they look',
  [isClosedStage('  Sold  '), isClosedStage(null)], [true, false]);

// --- the window's edges -------------------------------------------------
{
  const recs = [
    opp('Today', 'Sold', iso(9)),
    opp('Yesterday', 'Not Sold', iso(8)),
    opp('SevenDaysAgo', 'Sold', iso(2)),          // the boundary, inside
    opp('EightDaysAgo', 'Sold', iso(1)),          // one day past it
    opp('Tomorrow', 'Sold', iso(10)),             // dated in the future
    opp('StillOpen', 'Quoting', iso(9)),
    opp('NoDate', 'Sold', ''),
    opp('BadDate', 'Not Sold', 'whenever'),
  ];
  const { rows, undated } = recentlyClosedOpps(recs, { nowMs: NOW });

  check('the window is the last seven days, boundary included',
    names(rows), ['Today', 'Yesterday', 'SevenDaysAgo']);
  check('newest close first', rows.map(r => r._daysAgo), [0, 1, 7]);
  check('a close dated in the future is not in the past week',
    names(rows).includes('Tomorrow'), false);
  check('an open opp is not closed, whatever its dates say',
    names(rows).includes('StillOpen'), false);
  check('a closed opp with no usable Close Date is counted, not dropped',
    undated, 2);
  check('the default window is the one the page names',
    RECENTLY_CLOSED_DAYS, 7);

  // A shorter window narrows the list without changing anything else.
  const twoDays = recentlyClosedOpps(recs, { nowMs: NOW, days: 2 });
  check('the window is a parameter, not a constant baked into the filter',
    names(twoDays.rows), ['Today', 'Yesterday']);
}

// --- the age is whole days, not hours -----------------------------------
{
  // Same close date read at one minute past midnight and at bedtime: the
  // table must show the same thing to whoever opens it.
  const justAfterMidnight = new Date(2026, 8, 9, 0, 1).getTime();
  const lateEvening = new Date(2026, 8, 9, 23, 59).getTime();
  const r = opp('Acme', 'Sold', iso(6));
  check('a day is a day whatever the hour the page is opened',
    [daysSinceClose(r, justAfterMidnight), daysSinceClose(r, lateEvening)], [3, 3]);
  check('today is nought days ago', daysSinceClose(opp('A', 'Sold', iso(9)), NOW), 0);
  check('a future close is negative, not null — a different thing from undated',
    daysSinceClose(opp('A', 'Sold', iso(11)), NOW), -2);
  check('no date is null', daysSinceClose(opp('A', 'Sold', ''), NOW), null);
  check('a bare ISO date is not dragged back a day by the timezone',
    daysSinceClose({ 'Close Date': iso(9) }, NOW), 0);
  check('a slash date reads the same as the ISO one',
    daysSinceClose({ 'Close Date': '9/9/2026' }, NOW), 0);
}

// --- same day, stable order ---------------------------------------------
{
  const recs = [
    opp('Zenith', 'Sold', iso(8)),
    opp('Alpha', 'Not Sold', iso(8)),
    opp('Mid', 'Sold', iso(9)),
  ];
  const { rows } = recentlyClosedOpps(recs, { nowMs: NOW });
  check('ties on a day fall back to the account name',
    names(rows), ['Mid', 'Alpha', 'Zenith']);
  check('the row keeps the record it came from',
    rows[1].Stage, 'Not Sold');
}

// --- how the age reads --------------------------------------------------
check('the age label reads like a person would say it',
  [0, 1, 2, 7].map(closedAgoLabel), ['today', 'yesterday', '2 days ago', '7 days ago']);

// --- nothing to show ----------------------------------------------------
{
  check('no records is an empty week, not a crash',
    recentlyClosedOpps([], { nowMs: NOW }), { rows: [], undated: 0 });
  check('and neither is nothing at all',
    recentlyClosedOpps(null, { nowMs: NOW }), { rows: [], undated: 0 });
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
