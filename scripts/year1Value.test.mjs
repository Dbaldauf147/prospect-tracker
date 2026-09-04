// Assertion tests for the Year-1 value of a priced line item. Plain Node, no
// test framework (the project has none). Run:
//   node scripts/year1Value.test.mjs
//
// The rule that earns tests is Rolled: it bills monthly across the term while
// its cost lands upfront, so reading it as a full upfront charge overstates
// Year 1 by most of the charge — silently, on the row type whose whole
// purpose is that the customer doesn't pay it all in year one.
import { year1ValueFor, year1Months } from '../src/utils/year1Value.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const round2 = (n) => Math.round(n * 100) / 100;

// ── How much of Year 1 the term covers ────────────────────────────────────
check('months: a long term still bills 12', year1Months(36), 12);
check('months: exactly a year', year1Months(12), 12);
check('months: a short term truncates', year1Months(7), 7);
check('months: no term, no year', year1Months(0), 0);
check('months: nonsense', year1Months(), 0);

// ── Setup / One Time: billed once, in full ────────────────────────────────
check('setup: whole charge in year 1',
  year1ValueFor({ price: 9224, termMonths: 36 }), 9224);
check('setup: term length is irrelevant to a one-off',
  year1ValueFor({ price: 9224, termMonths: 6 }), 9224);

// ── Recurring: twelve months, unescalated ─────────────────────────────────
// The escalator starts in Year 2, so Year 1 is twelve months at face value.
check('recurring: twelve months',
  year1ValueFor({ price: 30196.73, termMonths: 36, recurring: true }), round2(30196.73 * 12));
check('recurring: a term under a year bills only what it covers',
  year1ValueFor({ price: 100, termMonths: 7, recurring: true }), 700);
check('recurring: no term bills nothing',
  year1ValueFor({ price: 100, termMonths: 0, recurring: true }), 0);

// ── Rolled: amortized, and this is the one that goes wrong quietly ────────
// A 36-month rolled setup of $36,000 puts $12,000 in Year 1 — not $36,000.
{
  const rolled = year1ValueFor({ price: 36000, termMonths: 36, rolled: true });
  check('rolled: a third of a three-year charge', rolled, 12000);
  check('rolled: NOT the face value', rolled === 36000, false);
}
check('rolled: a two-year charge halves',
  year1ValueFor({ price: 24000, termMonths: 24, rolled: true }), 12000);
check('rolled: a term inside a year bills the lot',
  year1ValueFor({ price: 9000, termMonths: 9, rolled: true }), 9000);
// Nothing to amortize over: bills in full, matching how a zero-month term
// behaves elsewhere on the page.
check('rolled: no term falls back to the whole charge',
  year1ValueFor({ price: 5000, termMonths: 0, rolled: true }), 5000);

// ── Junk in ───────────────────────────────────────────────────────────────
check('no price', year1ValueFor({ termMonths: 36 }), 0);
check('null price', year1ValueFor({ price: null, termMonths: 36 }), 0);
check('no input at all', year1ValueFor(), 0);

// ── The column adds up ────────────────────────────────────────────────────
// Setup $70,213.57 upfront + $15,969.42/mo recurring over 36 months is the
// shape of a real option: year one is the setup plus twelve months.
{
  const setup = year1ValueFor({ price: 70213.57, termMonths: 36 });
  const rec = year1ValueFor({ price: 15969.42, termMonths: 36, recurring: true });
  check('option: year 1 is setup + twelve months',
    round2(setup + rec), round2(70213.57 + 15969.42 * 12));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
