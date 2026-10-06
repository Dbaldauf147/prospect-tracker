// Assertion tests for the Contract Coverage tab's arithmetic: how much of a
// site's spend is open to re-sourcing in each year of the projection when it
// is tied up in a supply agreement, and how the Indicative Savings tab adds
// those sites up per market.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/contractCoverage.test.mjs
//
// Two things are pinned. The model itself (months still covered, a site's open
// spend by year, the per-market sum), and that the Excel formulas the tab
// writes compute the same numbers as the JS that produces their cached
// results. The second is the one that goes wrong quietly: the workbook opens
// on the cached figures and recalculates to the formula's, and a mismatch
// shows up as savings that change the moment somebody touches a cell.
import {
  COVERAGE_YEARS,
  utcDay,
  monthsUnderAgreement,
  siteOpenSpendByYear,
  monthsLockedFormula,
  siteOpenSpendFormula,
  marketOpenSpendFormula,
  siteBrokerSavingsFormula,
  siteBrokerSavingsByYear,
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

// ---- siteOpenSpendByYear ------------------------------------------------
{
  const open = siteOpenSpendByYear(1200, 0);
  check('no agreement: every year open', open.join(','), '1200,1200,1200,1200,1200');
  check('one figure per projection year', open.length, COVERAGE_YEARS);
}
{
  // Locked for 18 months: nothing in Year 1, the last six months of Year 2.
  const open = siteOpenSpendByYear(1200, 18);
  check('locked 18 months, Year 1', open[0], 0);
  check('locked 18 months, Year 2', open[1], 600);
  check('locked 18 months, Year 3', open[2], 1200);
}
check('locked for the horizon: nothing open in Year 5', siteOpenSpendByYear(1000, 60)[4], 0);
check('leased site held out of scope: nothing to open', siteOpenSpendByYear(0, 0)[0], 0);

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
    AND: (...xs) => xs.every(Boolean),
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
  const months = evalExcel(monthsLockedFormula('G8', '$B$2'), { G8: expiry, $B$2: start });
  check(`months formula matches the model (${label})`, months, monthsUnderAgreement(expiry, start));
  const model = siteOpenSpendByYear(48000, months);
  for (let n = 1; n <= COVERAGE_YEARS; n++) {
    const got = evalExcel(siteOpenSpendFormula('$F8', '$H8', n), { $F8: 48000, $H8: months });
    checkClose(`open spend formula Year ${n}, ends ${label}`, got, model[n - 1]);
  }
}

// The per-market sum picks out that market's sites and nothing else.
{
  const f = marketOpenSpendFormula("'Contract Coverage'!$B$7:$B$9", '$A16', "'Contract Coverage'!$K$7:$L$9");
  check('market sum formula shape', f, "SUMPRODUCT(('Contract Coverage'!$B$7:$B$9=$A16)*'Contract Coverage'!$K$7:$L$9)");
}

// ---- Broker fee savings ---------------------------------------------------
// Phased in on the same schedule as the site's open spend: SE only becomes
// the broker once the current agreement ends.
{
  const yrs = siteBrokerSavingsByYear(4000, 400000, 18);
  check('broker saving locked 18 months, Year 1', yrs[0], 0);
  check('broker saving locked 18 months, Year 2', yrs[1], 2000);
  check('broker saving locked 18 months, Year 3', yrs[2], 4000);
  check('an added cost stays negative', siteBrokerSavingsByYear(-2000, 400000, 0)[0], -2000);
  check('no eligible spend (leased, out of scope): nothing', siteBrokerSavingsByYear(4000, 0, 0)[0], 0);
  check('no saving worked out (a fee missing): nothing', siteBrokerSavingsByYear('', 400000, 0)[0], 0);
}
for (const [broker, spend, months] of [[4000, 400000, 18], [-2000, 400000, 0], [4000, 0, 0], ['', 400000, 0], [1500, 1000, 61]]) {
  const model = siteBrokerSavingsByYear(broker, spend, months);
  for (let n = 1; n <= COVERAGE_YEARS; n++) {
    const got = evalExcel(siteBrokerSavingsFormula('$F8', '$H8', '$J8', n), { $F8: broker === '' ? '""' : broker, $H8: spend, $J8: months });
    checkClose(`broker formula Year ${n} (saving ${JSON.stringify(broker)}, spend ${spend}, locked ${months})`, got, model[n - 1]);
  }
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll contract coverage checks passed.');
