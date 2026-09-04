// Assertion tests for pricing a recurring Alternative Fee to the target
// margin over the term it actually bills. Plain Node — no test framework
// (the project has none). Run:
//   node scripts/altFeePricing.test.mjs
//
// Two quiet, expensive failures live here. A fee derived from year-1 cost
// reads as on-target the day it's quoted and earns less every year after,
// because the cost escalator (3.85%) outruns the fee escalator (3%). And a
// fee that starts after month 1 bills fewer months than the cost behind it
// runs — three months of a 36-month term is 2pp of deal margin that no
// column showed.
import { billedMonthFactor, recurringFeePerUnit } from '../src/utils/altFeePricing.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const round = (n, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;

// ── The months a line actually bills ──────────────────────────────────────
check('no escalator, from month 1, is just the months', billedMonthFactor(0, 36, 1), 36);
check('36 months at 3% bills 37.09 months', round(billedMonthFactor(0.03, 36, 1), 4), 37.0908);
check('starting month 4 drops 3 months off year 1',
  round(billedMonthFactor(0.03, 36, 4), 4), round(9 + 12 * 1.03 + 12 * 1.0609, 4));
check('a start month inside year 2 skips year 1 entirely',
  round(billedMonthFactor(0.03, 36, 15), 4), round(10 * 1.03 + 12 * 1.0609, 4));
check('a start month past the term bills nothing', billedMonthFactor(0.03, 36, 37), 0);
check('no term, no months', billedMonthFactor(0.03, 0, 1), 0);
check('a start month before month 1 is month 1', billedMonthFactor(0, 36, 0), 36);

// ── The margin the derived fee actually earns ─────────────────────────────
// The whole point: revenue over the months billed, against cost over the
// months incurred, comes back at exactly the target.
function termMargin({ cost, gm, ae, ce, months, units = 1, feeStart = 1, costStart = 1 }) {
  const fee = recurringFeePerUnit({
    recurringCosts: [{ price: cost / (1 - gm), startMonth: costStart }],
    feeStartMonth: feeStart,
    annualEscalator: ae, costEscalator: ce, termMonths: months, unitCount: units,
  });
  const revenue = fee * units * billedMonthFactor(ae, months, feeStart);
  const termCost = cost * billedMonthFactor(ce, months, costStart);
  return round((revenue - termCost) / revenue, 6);
}
const base = { cost: 1000, gm: 0.45, ae: 0.03, ce: 0.0385, months: 36 };
check('45% target, escalators 3% vs 3.85%, holds over the term', termMargin(base), 0.45);
check('50% target holds too', termMargin({ ...base, cost: 4321, gm: 0.5 }), 0.5);
check('a 60-month term holds', termMargin({ ...base, months: 60 }), 0.45);
check('unit counts divide out', termMargin({ ...base, units: 15000 }), 0.45);
check('a fee starting month 4 against cost from month 1 still holds',
  termMargin({ ...base, feeStart: 4 }), 0.45);
check('a fee starting mid-term still holds', termMargin({ ...base, feeStart: 15 }), 0.45);
check('fee and cost both starting month 4 holds', termMargin({ ...base, feeStart: 4, costStart: 4 }), 0.45);

// The fee has to carry the months it doesn't bill, so a later start costs
// the customer more per month.
{
  const fee = (feeStart) => recurringFeePerUnit({
    recurringCosts: [{ price: 1000 / 0.55 }], feeStartMonth: feeStart,
    annualEscalator: 0.03, costEscalator: 0.0385, termMonths: 36, unitCount: 1,
  });
  check('a fee starting month 4 is dearer per month than one starting month 1',
    fee(4) > fee(1), true);
  check('…by the ratio of the months each bills',
    round(fee(4) / fee(1), 6),
    round(billedMonthFactor(0.03, 36, 1) / billedMonthFactor(0.03, 36, 4), 6));
}

// Matching escalators from month 1 is the case the old year-1 derivation got
// right, so the fee must not move there.
check('escalators equal, no delay → the plain marked-up monthly price',
  round(recurringFeePerUnit({ recurringCosts: [{ price: 1000 }], annualEscalator: 0.03, costEscalator: 0.03, termMonths: 36, unitCount: 1 })),
  1000);
check('no escalators at all → the plain marked-up monthly price',
  round(recurringFeePerUnit({ recurringCosts: [{ price: 1000 }], annualEscalator: 0, costEscalator: 0, termMonths: 36, unitCount: 1 })),
  1000);

// A Rolled cost is incurred once, so the term recovers it once — spreading
// it over an escalating schedule as cost ÷ months over-bills by the escalator.
{
  const fee = recurringFeePerUnit({
    rolledCosts: [{ price: 3600 }], annualEscalator: 0.03, costEscalator: 0.0385, termMonths: 36, unitCount: 1,
  });
  check('a rolled cost is recovered exactly once over the term',
    round(fee * billedMonthFactor(0.03, 36, 1), 4), 3600);
  check('…which is less per month than cost ÷ months', fee < 100, true);
}
{
  // Both kinds behind one fee add up, each on its own start month.
  const fee = recurringFeePerUnit({
    recurringCosts: [{ price: 1000, startMonth: 1 }, { price: 500, startMonth: 13 }],
    rolledCosts: [{ price: 3600, startMonth: 1 }],
    annualEscalator: 0.03, costEscalator: 0.0385, termMonths: 36, unitCount: 1,
  });
  check('every linked cost lands in the fee on its own clock',
    round(fee * billedMonthFactor(0.03, 36, 1), 4),
    round(1000 * billedMonthFactor(0.0385, 36, 1) + 500 * billedMonthFactor(0.0385, 36, 13) + 3600, 4));
}
{
  const fee = recurringFeePerUnit({
    rolledCosts: [{ price: 3600, startMonth: 40 }],
    annualEscalator: 0.03, termMonths: 36, unitCount: 1,
  });
  check('a rolled cost starting past the term is not priced', fee, null);
}

// ── Nothing to price against ──────────────────────────────────────────────
check('no linked price', recurringFeePerUnit({ annualEscalator: 0.03, termMonths: 36, unitCount: 1 }), null);
check('no unit count', recurringFeePerUnit({ recurringCosts: [{ price: 100 }], termMonths: 36, unitCount: 0 }), null);
check('no term', recurringFeePerUnit({ recurringCosts: [{ price: 100 }], termMonths: 0, unitCount: 1 }), null);
check('a fee starting past the term', recurringFeePerUnit({ recurringCosts: [{ price: 100 }], feeStartMonth: 40, termMonths: 36, unitCount: 1 }), null);
check('no arguments', recurringFeePerUnit(), null);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
