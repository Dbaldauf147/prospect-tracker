// Assertion tests for pricing a recurring Alternative Fee to the target
// margin over the whole term. Plain Node — no test framework (the project
// has none). Run:
//   node scripts/altFeePricing.test.mjs
//
// The failure this pins is quiet and expensive: a fee derived from year-1
// cost reads as on-target on the day it's quoted and earns less every year
// after, because the cost escalator (3.85%) outruns the fee escalator (3%).
import { termMonthFactor, recurringFeePerUnit } from '../src/utils/altFeePricing.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const round = (n, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;

// ── The escalated month count of a term ───────────────────────────────────
check('no escalator is just the months', termMonthFactor(0, 36), 36);
check('36 months at 3% bills 37.09 months', round(termMonthFactor(0.03, 36), 4), 37.0908);
check('a part year escalates from its own band', round(termMonthFactor(0.03, 18), 4), round(12 + 6 * 1.03, 4));
check('no term, no months', termMonthFactor(0.03, 0), 0);

// ── The margin the derived fee actually earns ─────────────────────────────
// The whole point: revenue over the term, against cost over the term, comes
// back at exactly the target.
function termMargin({ cost, gm, ae, ce, months, units = 1 }) {
  const fee = recurringFeePerUnit({
    recurringMonthlyPrice: cost / (1 - gm),
    annualEscalator: ae, costEscalator: ce, termMonths: months, unitCount: units,
  });
  const revenue = fee * units * termMonthFactor(ae, months);
  const termCost = cost * termMonthFactor(ce, months);
  return round((revenue - termCost) / revenue, 6);
}
check('45% target, escalators 3% vs 3.85%, holds over the term',
  termMargin({ cost: 1000, gm: 0.45, ae: 0.03, ce: 0.0385, months: 36 }), 0.45);
check('50% target holds too', termMargin({ cost: 4321, gm: 0.5, ae: 0.03, ce: 0.0385, months: 36 }), 0.5);
check('a 60-month term holds', termMargin({ cost: 1000, gm: 0.45, ae: 0.03, ce: 0.0385, months: 60 }), 0.45);
check('unit counts divide out', termMargin({ cost: 1000, gm: 0.45, ae: 0.03, ce: 0.0385, months: 36, units: 15000 }), 0.45);

// Matching escalators are the case the old year-1 derivation got right, so
// the fee must not move there.
check('escalators equal → the plain marked-up monthly price',
  round(recurringFeePerUnit({ recurringMonthlyPrice: 1000, annualEscalator: 0.03, costEscalator: 0.03, termMonths: 36, unitCount: 1 })),
  1000);
check('no escalators at all → the plain marked-up monthly price',
  round(recurringFeePerUnit({ recurringMonthlyPrice: 1000, annualEscalator: 0, costEscalator: 0, termMonths: 36, unitCount: 1 })),
  1000);
check('a cost escalator above the fee escalator lifts the fee',
  recurringFeePerUnit({ recurringMonthlyPrice: 1000, annualEscalator: 0.03, costEscalator: 0.0385, termMonths: 36, unitCount: 1 }) > 1000,
  true);

// A Rolled cost is incurred once, so the term recovers it once — spreading
// it over an escalating schedule as cost/months over-bills by the escalator.
{
  const fee = recurringFeePerUnit({
    rolledUpfrontPrice: 3600, annualEscalator: 0.03, costEscalator: 0.0385, termMonths: 36, unitCount: 1,
  });
  check('a rolled cost is recovered exactly once over the term',
    round(fee * termMonthFactor(0.03, 36), 4), 3600);
  check('…which is less per month than cost ÷ months', fee < 100, true);
}
{
  // Both kinds behind one fee add up.
  const fee = recurringFeePerUnit({
    recurringMonthlyPrice: 1000, rolledUpfrontPrice: 3600,
    annualEscalator: 0.03, costEscalator: 0.0385, termMonths: 36, unitCount: 1,
  });
  check('monthly and rolled costs both land in the fee',
    round(fee * termMonthFactor(0.03, 36), 4),
    round(1000 * termMonthFactor(0.0385, 36) + 3600, 4));
}

// ── Nothing to price against ──────────────────────────────────────────────
check('no linked price', recurringFeePerUnit({ annualEscalator: 0.03, termMonths: 36, unitCount: 1 }), null);
check('no unit count', recurringFeePerUnit({ recurringMonthlyPrice: 100, termMonths: 36, unitCount: 0 }), null);
check('no term', recurringFeePerUnit({ recurringMonthlyPrice: 100, termMonths: 0, unitCount: 1 }), null);
check('no arguments', recurringFeePerUnit(), null);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
