// Assertion tests for "Not on tier list, but Dan target" (the checkbox
// under Tier on the company card, `tierOwnTarget`): tier reporting reads
// such a company as Tier 3. Plain Node, no framework. Run:
//   node scripts/ownTargetTier.test.mjs
import { isOwnTarget, reportingTier, onMyBook } from '../src/utils/tierSource.js';
import { myTieredAccounts, tierActivityCoverage, firmBucket, myAccounts } from '../src/utils/tieredAccountActivity.js';
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
// Ticked, then moved to a real tier (the card's Targets-list fix does this).
const stale = { id: 's', company: 'Stale', cdm: 'Dan Baldauf', tier: 'Tier 2', tierOwnTarget: true };
const prospects = [own, plainNot, t1, stale];

eq(isOwnTarget(own), true, 'ticked and Not on tier list: own target');
eq(isOwnTarget(plainNot), false, 'Not on tier list, unticked: not');
eq(isOwnTarget(stale), true, 'ticked on a real tier: still an own target');
eq(reportingTier(own), 'Tier 3', 'own target reports as Tier 3');
eq(reportingTier(plainNot), 'Not on tier list', 'plain Not on tier list unchanged');
eq(reportingTier(stale), 'Tier 2', 'an own target keeps a real tier');
eq(reportingTier({ tier: '', tierOwnTarget: true }), 'Tier 3', 'ticked with no tier: Tier 3');
eq(reportingTier({ tier: ' Tier 1 ' }), 'Tier 1', 'trimmed');
eq(reportingTier(null), '', 'nothing: blank');

eq(myTieredAccounts(prospects, 'Dan Baldauf').map(p => p.id), ['a', 's', 'm'], 'Tiered tab includes the own target, with Tier 3');
eq(tierActivityCoverage(prospects, new Map()).map(c => c.total), [1, 1, 1], 'coverage counts it under Tier 3');
eq(firmBucket(own), 'Tier 3', 'active-firms chart buckets it as Tier 3');
eq(firmBucket(plainNot), 'Not tiered', 'plain Not on tier list stays Not tiered');
eq(tierAccounts(prospects, 'Dan Baldauf', 'Tier 3').map(p => p.id), ['m'], 'decision-maker coverage includes it in Tier 3');
eq(accountTier({ Account: 'Maymont Homes' }, prospects), 'Tier 3', 'opp digests read its account as Tier 3');
eq(accountTier({ Account: 'Nope' }, prospects), 'Not on tier list', 'plain Not on tier list unchanged in digests');

// An own target counts on Dan's book whoever its CDM is; a plain account
// under another CDM does not.
const otherCdmOwn = { id: 'o', company: 'Amherst Group', cdm: 'Someone Else', tier: 'Not on tier list', tierOwnTarget: true };
const otherCdmT1 = { id: 'x', company: 'Other T1', cdm: 'Someone Else', tier: 'Tier 1' };
const book = [...prospects, otherCdmOwn, otherCdmT1];
eq(onMyBook(otherCdmOwn, 'Dan Baldauf'), true, 'own target under another CDM: on my book');
eq(onMyBook(otherCdmT1, 'Dan Baldauf'), false, 'another CDM, plain tier: not on my book');
eq(onMyBook(t1, 'Dan Baldauf'), true, 'my CDM: on my book');
eq(myTieredAccounts(book, 'Dan Baldauf').map(p => p.id), ['a', 's', 'o', 'm'], 'Tiered tab includes own targets under any CDM');
eq(myAccounts(book, 'Dan Baldauf').map(p => p.id).sort(), ['a', 'm', 'n', 'o', 's'], 'active-firms chart includes them too');
eq(tierAccounts(book, 'Dan Baldauf', 'Tier 3').map(p => p.id), ['m', 'o'], 'decision-maker coverage includes them in Tier 3');

// Amherst Group as it is on the card: Tier 3 (from the Targets-list fix),
// box ticked, another CDM. On the book, as Tier 3.
const amherst = { id: 'h', company: 'Amherst Group', cdm: 'Kristi McNary', tier: 'Tier 3', tierOwnTarget: true };
eq(onMyBook(amherst, 'Dan Baldauf'), true, 'Amherst: ticked Tier 3 under another CDM is on my book');
eq(reportingTier(amherst), 'Tier 3', 'Amherst: counts as Tier 3');
eq(myTieredAccounts([amherst], 'Dan Baldauf').map(p => p.id), ['h'], 'Amherst: on the Tiered tab');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
