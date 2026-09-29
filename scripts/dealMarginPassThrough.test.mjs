// Assertion tests for keeping pass-through out of the Deal margin. Plain
// Node, no test framework. Run:
//   node scripts/dealMarginPassThrough.test.mjs
//
// A pass-through cost line logged on a fee row ticked Pass was carved out
// twice on the revenue side: once as CTS pass-through (its cost) and once
// as the Pass row's own revenue. The margin then read ~5pp low on a deal
// with a Cass pass-through line. Cost on a Pass row comes off the cost
// side only; the row's revenue carve-out covers the rest.
import { cumulativeDealMargins } from '../src/utils/pricingOptionCalc.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const r4 = (n) => (n == null ? n : Math.round(n * 10000) / 10000);

// 1,000 of fees, 600 of cost; a 100 pass-through fee row carrying 100 of
// cost. Without the pass-through the deal is 800 of fees on 500 of cost.
const withPassFee = cumulativeDealMargins({
  feeByYear: [1000], costByYear: [600], altPassByYear: [100], altPassCostByYear: [100],
});
check('pass fee row: margin matches the deal without it', r4(withPassFee.finalMargin), r4((900 - 500) / 900));
check('pass fee row: term revenue', withPassFee.termRevenue, 900);
check('pass fee row: term cost', withPassFee.termCost, 500);

// Pass-through cost folded into an ordinary fee still comes off both sides.
const folded = cumulativeDealMargins({ feeByYear: [1000], costByYear: [600], ctsPassByYear: [100] });
check('folded pass-through', r4(folded.finalMargin), r4((900 - 500) / 900));

// Cumulative across years.
const years = cumulativeDealMargins({
  feeByYear: [500, 500], costByYear: [300, 300], altPassByYear: [50, 50], altPassCostByYear: [50, 50],
});
check('cumulative years', years.marginByYear.map(r4), [r4(200 / 450), r4(400 / 900)]);

// Omitting the new argument leaves the old formula untouched.
check('no pass-through', r4(cumulativeDealMargins({ feeByYear: [1000], costByYear: [600] }).finalMargin), 0.4);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
