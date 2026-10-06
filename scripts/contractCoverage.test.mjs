// Assertion tests for the Contract Coverage tab's arithmetic: how much of a
// market's spend is open to re-sourcing in each year of the projection once
// part of it is tied up in a supply agreement.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/contractCoverage.test.mjs
//
// Two things are pinned. The model itself (months still covered, open spend
// by year, the seed read off the sites), and that the Excel formulas the tab
// writes compute the same numbers as the JS that produces their cached
// results. The second is the one that goes wrong quietly: the workbook opens
// on the cached figures and recalculates to the formula's, and a mismatch
// shows up as savings that change the moment somebody touches a cell.
import {
  COVERAGE_YEARS,
  utcDay,
  monthsUnderAgreement,
  openSpendByYear,
  coverageSeed,
  monthsLockedFormula,
  openSpendFormula,
} from '../src/components/SitesView/contractCoverage.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}
const close = (a, b) => Math.abs(a - b) < 1e-6;
function checkClose(label, actual, expected) {
  const ok = close(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${actual}, want ${expected})`}`);
}

const d = (y, m, day) => new Date(Date.UTC(y, m - 1, day));
const start = d(2026, 10, 1);

// ---- monthsUnderAgreement ------------------------------------------------
check('no agreement covers nothing', monthsUnderAgreement(null, start), 0);
check('an agreement already ended covers nothing', monthsUnderAgreement(d(2025, 3, 15), start), 0);
check('ending on the projection start covers nothing', monthsUnderAgreement(d(2026, 10, 1), start), 0);
check('ending mid-month covers that month', monthsUnderAgreement(d(2026, 10, 15), start), 1);
check('ending on the 1st frees that month', monthsUnderAgreement(d(2027, 10, 1), start), 12);
check('ending on the 2nd covers that month too', monthsUnderAgreement(d(2027, 10, 2), start), 13);
check('capped at the 5-year horizon', monthsUnderAgreement(d(2040, 1, 1), start), 60);

// ---- openSpendByYear -----------------------------------------------------
{
  const open = openSpendByYear(1200, 0, 0);
  check('nothing under agreement: every year open', open.join(','), '1200,1200,1200,1200,1200');
  check('one figure per projection year', open.length, COVERAGE_YEARS);
}
{
  // Half the spend locked for 18 months: Year 1 has only the free half,
  // Year 2 picks the locked half up for its last six months.
  const open = openSpendByYear(1200, 0.5, 18);
  check('half locked 18 months, Year 1', open[0], 600);
  check('half locked 18 months, Year 2', open[1], 900);
  check('half locked 18 months, Year 3', open[2], 1200);
}
{
  const open = openSpendByYear(1000, 1, 60);
  check('fully locked for the horizon: nothing open in Year 5', open[4], 0);
}
check('share above 100% is clamped', openSpendByYear(1000, 1.7, 60)[0], 0);
check('negative share is clamped', openSpendByYear(1000, -0.4, 60)[0], 1000);

// ---- coverageSeed --------------------------------------------------------
{
  const seed = coverageSeed([
    { spend: 300, end: d(2027, 4, 10) },
    { spend: 100, end: d(2027, 12, 10) },
    { spend: 600, end: d(2025, 1, 1) },   // already ended
    { spend: 0, end: d(2030, 1, 1) },     // leased: under contract, no eligible spend
    { spend: 250, end: null },            // no agreement on file
  ], start);
  check('seed counts every site', seed.sites, 5);
  check('seed counts the sites still under agreement', seed.coveredSites, 3);
  check('seed covered spend', seed.coveredSpend, 400);
  checkClose('seed share is covered / total eligible spend', seed.coveredShare, 400 / 1250);
  // Spend-weighted: three quarters of the covered dollars end Apr 10 2027,
  // one quarter Dec 10 2027, so the average lands two months after the
  // first: mid-June 2027, which covers Oct 2026 through Jun 2027.
  check('seed expiry is the spend-weighted average', seed.expiry.toISOString().slice(0, 7), '2027-06');
  check('seed expiry months under agreement', monthsUnderAgreement(seed.expiry, start), 9);
}
{
  const seed = coverageSeed([{ spend: 500, end: null }], start);
  check('no agreements: share 0', seed.coveredShare, 0);
  check('no agreements: no expiry', seed.expiry, null);
}
check('no sites: share 0', coverageSeed([], start).coveredShare, 0);
check('utcDay keeps the calendar day', utcDay(new Date(2027, 2, 9, 23, 30)).toISOString().slice(0, 10), '2027-03-09');

// ---- The formulas agree with the model -----------------------------------
// A small evaluator for the handful of Excel functions the tab uses. Cell
// references are substituted with their values; nothing else in these
// formulas needs Excel.
function evalExcel(formula, cells) {
  let js = formula;
  for (const [ref, value] of Object.entries(cells)) {
    const literal = value instanceof Date ? `__date(${value.getTime()})` : (value == null ? 'null' : String(value));
    js = js.split(ref).join(literal);
  }
  const fns = {
    IF: (c, a, b) => (c ? a : b),
    MAX: Math.max,
    MIN: Math.min,
    N: (v) => (typeof v === 'number' ? v : 0),
    ISNUMBER: (v) => v instanceof Date || typeof v === 'number',
    // NaN for a blank: JS evaluates both branches of IF where Excel
    // doesn't, and the blank-date branch is the one IF discards.
    YEAR: (v) => (v ? v.getUTCFullYear() : NaN),
    MONTH: (v) => (v ? v.getUTCMonth() + 1 : NaN),
    DAY: (v) => (v ? v.getUTCDate() : NaN),
    __date: (ms) => new Date(ms),
  };
  return new Function(...Object.keys(fns), `return (${js});`)(...Object.values(fns));
}

for (const expiry of [null, d(2026, 10, 1), d(2026, 12, 20), d(2028, 3, 1), d(2028, 3, 2), d(2033, 6, 30)]) {
  const label = expiry ? expiry.toISOString().slice(0, 10) : 'blank';
  const months = evalExcel(monthsLockedFormula('H8', '$C$2'), { H8: expiry, $C$2: start });
  check(`months formula matches the model (${label})`, months, monthsUnderAgreement(expiry, start));
  for (const share of [0, 0.35, 1]) {
    const model = openSpendByYear(48000, share, months);
    for (let n = 1; n <= COVERAGE_YEARS; n++) {
      const f = openSpendFormula('$F8', '$G8', '$I8', n);
      const got = evalExcel(f, { $F8: 48000, $G8: share, $I8: months });
      checkClose(`open spend formula Year ${n}, share ${share}, ends ${label}`, got, model[n - 1]);
    }
  }
}
// A blank share cell reads as nothing under agreement.
checkClose('blank share reads as 0', evalExcel(openSpendFormula('$F8', '$G8', '$I8', 1), { $F8: 1000, $G8: null, $I8: 24 }), 1000);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll contract coverage checks passed.');
