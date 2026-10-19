// Assertion tests for "Not on tier list, but Dan target" (the checkbox
// under Tier on the company card, `tierOwnTarget`): tier reporting reads
// such a company as Tier 3. Plain Node, no framework. Run:
//   node scripts/ownTargetTier.test.mjs
import { isOwnTarget, reportingTier } from '../src/utils/tierSource.js';
import { myTieredAccounts, tierActivityCoverage, firmBucket } from '../src/utils/tieredAccountActivity.js';
import { tierAccounts } from '../src/utils/decisionMakerCoverage.js';
import { accountTier } from '../src/utils/keithPeDeals.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const own = { id: 'm', company: 'Maymont Homes', cdm: 'Dan Baldauf', tier: 'Not on tier list', tierOwnTarget: true };
const plainNot = { id: 'n', company: 'Nope', cdm: 'Dan Baldauf', tier: 'Not on tier list' };
const t1 = { id: 'a', company: 'Acme', cdm: 'Dan Baldauf', tier: 'Tier 1' };
// A stale flag left on a company someone later moved to a real tier.
const stale = { id: 's', company: 'Stale', cdm: 'Dan Baldauf', tier: 'Tier 2', tierOwnTarget: true };
const prospects = [own, plainNot, t1, stale];

eq(isOwnTarget(own), true, 'ticked and Not on tier list: own target');
eq(isOwnTarget(plainNot), false, 'Not on tier list, unticked: not');
eq(isOwnTarget(stale), false, 'ticked but on a real tier: not');
eq(reportingTier(own), 'Tier 3', 'own target reports as Tier 3');
eq(reportingTier(plainNot), 'Not on tier list', 'plain Not on tier list unchanged');
eq(reportingTier(stale), 'Tier 2', 'a real tier wins over the flag');
eq(reportingTier({ tier: ' Tier 1 ' }), 'Tier 1', 'trimmed');
eq(reportingTier(null), '', 'nothing: blank');

eq(myTieredAccounts(prospects, 'Dan Baldauf').map(p => p.id), ['a', 's', 'm'], 'Tiered tab includes the own target, with Tier 3');
eq(tierActivityCoverage(prospects, new Map()).map(c => c.total), [1, 1, 1], 'coverage counts it under Tier 3');
eq(firmBucket(own), 'Tier 3', 'active-firms chart buckets it as Tier 3');
eq(firmBucket(plainNot), 'Not tiered', 'plain Not on tier list stays Not tiered');
eq(tierAccounts(prospects, 'Dan Baldauf', 'Tier 3').map(p => p.id), ['m'], 'decision-maker coverage includes it in Tier 3');
eq(accountTier({ Account: 'Maymont Homes' }, prospects), 'Tier 3', 'opp digests read its account as Tier 3');
eq(accountTier({ Account: 'Nope' }, prospects), 'Not on tier list', 'plain Not on tier list unchanged in digests');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
