// Assertion tests for the date box in the click-to-pick calendar popup
// (components/common/DateCell). Plain Node — no test framework (the project
// has none). Run:
//   node scripts/typedDate.test.mjs
//
// The parser is the whole risk in that box. A picker can only produce dates
// that exist; a text field takes 2/30, 13/1, half-typed "3/", and pasted
// values in whatever shape the source used — and the difference between
// "not a date" and "clear this cell" decides whether Enter wipes a contract
// date or does nothing.
import { parseTypedDate, toISODate, formatDateDisplay } from '../src/utils/isoDate.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const thisYear = new Date().getFullYear();

// ---- the shapes a person types --------------------------------------------

eq(parseTypedDate('3/5/2026'), '2026-03-05', 'M/D/YYYY is read as month first');
eq(parseTypedDate('03/05/2026'), '2026-03-05', 'leading zeros are accepted');
eq(parseTypedDate('12/31/2026'), '2026-12-31', 'the last day of the year parses');
eq(parseTypedDate('3-5-2026'), '2026-03-05', 'dashes work as separators');
eq(parseTypedDate('3.5.2026'), '2026-03-05', 'so do dots, which some keypads make easier');
eq(parseTypedDate('  3/5/2026  '), '2026-03-05', 'surrounding whitespace is ignored');

// A two-digit year reads the way a spreadsheet reads it, since that is where
// most of these dates come from.
eq(parseTypedDate('3/5/26'), '2026-03-05', 'a two-digit year in this century fills in');
eq(parseTypedDate('3/5/99'), '1999-03-05', 'a two-digit year of 70+ is last century');
eq(parseTypedDate('3/5/69'), '2069-03-05', 'the century boundary sits at 70, as in Excel');
eq(parseTypedDate('3/5'), `${thisYear}-03-05`, 'a missing year means this year');

// ---- what must NOT become a date ------------------------------------------

eq(parseTypedDate(''), '', 'an empty box is a request to clear, not a parse failure');
eq(parseTypedDate('   '), '', 'a box holding only spaces is still empty');
eq(parseTypedDate(null), '', 'a null draft reads as empty rather than throwing');

eq(parseTypedDate('2/30/2026'), null, 'a day past the end of the month is rejected, not rolled into March');
eq(parseTypedDate('4/31/2026'), null, 'a 31st in a 30-day month is rejected');
eq(parseTypedDate('13/1/2026'), null, 'a month past 12 is rejected');
eq(parseTypedDate('0/5/2026'), null, 'month zero is rejected');
eq(parseTypedDate('3/0/2026'), null, 'day zero is rejected');
eq(parseTypedDate('3/'), null, 'a half-typed date is not a date yet');
eq(parseTypedDate('abc'), null, 'text that is not a date is rejected');
eq(parseTypedDate('45000'), null, "a bare number is not read as a year — Date.parse would call this the year 45000");
eq(parseTypedDate('3'), null, 'a single digit is not a date');
eq(parseTypedDate('3/5/'), null, 'a trailing separator is not a date yet');
eq(parseTypedDate('2026-'), null, 'a year on its own is not a date yet');
eq(parseTypedDate('2026-02-30'), null, 'an impossible ISO date is rejected, not passed through');

// Leap years are the case a hand-rolled day check gets wrong.
eq(parseTypedDate('2/29/2024'), '2024-02-29', 'Feb 29 in a leap year is a real date');
eq(parseTypedDate('2/29/2026'), null, 'Feb 29 in a common year is not');
eq(parseTypedDate('2/29/2000'), '2000-02-29', 'a century divisible by 400 is a leap year');
eq(parseTypedDate('2/29/1900'), null, 'a century not divisible by 400 is not');

// ---- pasted values --------------------------------------------------------
// The box takes anything the rest of the app can already read, so a value
// copied out of another cell or a contract pastes straight in.

eq(parseTypedDate('2026-03-05'), '2026-03-05', 'an ISO date pastes in unchanged');
eq(parseTypedDate('March 5, 2026'), '2026-03-05', 'a written-out date pastes in');
eq(parseTypedDate('Mar 5 2026'), '2026-03-05', 'so does the abbreviated form');

// ---- the round trip -------------------------------------------------------
// The box is seeded with the cell's displayed value, so what it shows on open
// has to parse back to the same day — otherwise opening a popup and pressing
// Enter would move the date.

for (const iso of ['2026-03-05', '2024-02-29', '1999-12-31', '2026-01-01']) {
  eq(parseTypedDate(formatDateDisplay(iso)), iso, `${iso} survives display → typed → stored`);
}
eq(toISODate(parseTypedDate('3/5/2026')), '2026-03-05', 'what the box returns is what the cell stores');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
