// Assertion tests for the estimate-vs-actual-quote comparison.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/quotedVariance.test.mjs
//
// The rules worth pinning: nothing is shown before a real quote exists
// (the estimate compared against itself would read as a confident 0% on
// a deal nobody has quoted), the sign says which way the quote went, and
// a zero estimate yields no percentage rather than an invented one.
import {
  quotedVariance, formatQuotedVariance, quotedVarianceTone, QUOTED_VARIANCE_COLUMN,
} from '../src/utils/quotedVariance.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const withSia = (fields) => ({ _pricingOption: { year1Total: 1 }, ...fields });

// --- nothing to compare yet -------------------------------------------
// Before an SIA lands, Quoted Amount still holds what the Lead popup put
// there — the estimate. Comparing it with itself is a 0% that means
// nothing happened, not that the quote came in on the nose.
check('no SIA attached, no comparison',
  quotedVariance({ 'Estimated Fee': '$66,000', 'Quoted Amount': '$66,000' }), null);
check('no estimate to measure against',
  quotedVariance(withSia({ 'Quoted Amount': '$74,400' })), null);
check('no quote on the row', quotedVariance(withSia({ 'Estimated Fee': '$66,000' })), null);
check('an unreadable figure is not a comparison',
  quotedVariance(withSia({ 'Estimated Fee': 'TBD', 'Quoted Amount': '$74,400' })), null);
check('no opp at all', quotedVariance(null), null);

// --- the comparison ---------------------------------------------------
{
  const v = quotedVariance(withSia({ 'Estimated Fee': '$66,000', 'Quoted Amount': '$74,400' }));
  check('quoted above the estimate', [v.delta, Number(v.pct.toFixed(4))], [8400, 12.7273]);
  check('and reads as over', quotedVarianceTone(v), 'over');
  check('formatted with both halves signed', formatQuotedVariance(v), '+$8,400 (+12.7%)');
}
{
  const v = quotedVariance(withSia({ 'Estimated Fee': '$100,000', 'Quoted Amount': '$85,000' }));
  check('quoted below the estimate', v.delta, -15000);
  check('reads as under', quotedVarianceTone(v), 'under');
  // The minus belongs on both halves: "$15,000 (15.0%)" doesn't say which
  // way it went, and which way is the whole question.
  check('the sign is on the money and the percentage', formatQuotedVariance(v), '-$15,000 (-15.0%)');
}
{
  const v = quotedVariance(withSia({ 'Estimated Fee': '$50,000', 'Quoted Amount': '$50,000' }));
  check('bang on', [v.delta, v.pct], [0, 0]);
  check('reads as even', quotedVarianceTone(v), 'even');
  check('and prints unsigned', formatQuotedVariance(v), '$0 (0.0%)');
}

// A zero estimate has no percentage — the delta is real, the share of
// nothing is not.
{
  const v = quotedVariance(withSia({ 'Estimated Fee': '$0', 'Quoted Amount': '$40,000' }));
  check('a zero estimate still gives the dollar gap', v.delta, 40000);
  check('but no percentage', v.pct, null);
  check('and prints the money alone', formatQuotedVariance(v), '+$40,000');
}

// Raw numbers, not just formatted cells — records written by other paths
// carry either.
check('plain numbers work too',
  quotedVariance(withSia({ 'Estimated Fee': 20000, 'Quoted Amount': 25000 })).delta, 5000);

// --- the latest of each side ------------------------------------------
// No history is kept here: each side is whatever was last written to its
// cell, so a re-run Lead popup or a second SIA is picked up for free.
{
  const afterSecondSia = withSia({ 'Estimated Fee': '$66,000', 'Quoted Amount': '$90,000' });
  check('a newer quote is what gets compared',
    quotedVariance(afterSecondSia).delta, 24000);
  const afterNewEstimate = { ...afterSecondSia, 'Estimated Fee': '$88,000' };
  check('and a newer estimate moves the baseline',
    quotedVariance(afterNewEstimate).delta, 2000);
}

check('nothing formats to nothing', formatQuotedVariance(null), '');
check('the column has a name', QUOTED_VARIANCE_COLUMN, 'Estimated vs. Actual Quoted');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
