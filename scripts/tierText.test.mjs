// Roman-numeral tiers on the Target Accounts list ("Tier III") read as
// their digits. Plain Node. Run:
//   node scripts/tierText.test.mjs
import { normalizeTierText } from '../src/utils/tierText.js';
import { targetRowTier, buildTargetTierResolver, tierMismatch } from '../src/utils/targetTier.js';
import { targetAccountRows } from '../src/utils/targetAccountMatch.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('Tier III', normalizeTierText('Tier III'), 'Tier 3');
check('lower case', normalizeTierText('tier ii'), 'Tier 2');
check('bare III', normalizeTierText('III'), '3');
check('Tier IV / IX / VIII', ['Tier IV', 'Tier IX', 'Tier VIII'].map(normalizeTierText), ['Tier 4', 'Tier 9', 'Tier 8']);
check('Tier-II', normalizeTierText('Tier-II'), 'Tier 2');
check('digits untouched', ['Tier 3', '3', ''].map(normalizeTierText), ['Tier 3', '3', '']);
check('words untouched', ['Tier', 'Not on tier list', 'Tier Viking', 'Dan Iii'].map(normalizeTierText),
  ['Tier', 'Not on tier list', 'Tier Viking', 'Dan Iii']);

check('row with Tier III reads Tier 3', targetRowTier({ 'Account Name': 'Triumph Group', Tier: 'Tier III' }), 'Tier 3');
check('row with bare III reads Tier 3', targetRowTier({ 'Account Name': 'Triumph Group', Tier: 'III' }), 'Tier 3');

// Triumph Group: "Tier III" on the list, Tier 3 on the card. No warning
// from the Targets list box or the Tier dropdown.
const data = { sheetNames: ['S'], sheets: { S: { headers: ['Account Name', 'CDM', 'Tier'], records: [
  { 'Account Name': 'Triumph Group', CDM: 'Dan Baldauf', Tier: 'Tier III' },
] } } };
const settings = { targetMap: { p1: ['Triumph Group'] } };
check('box reads Tier 3', targetAccountRows(data, settings)[0].tier, 'Tier 3');
const resolve = buildTargetTierResolver({ targetAccountsData: data, cdmName: 'Dan Baldauf', settings, includeAllReps: true });
check('mapped: no warning', tierMismatch('Tier 3', resolve({ id: 'p1', company: 'Triumph Group' })), null);
check('by name: no warning', tierMismatch('Tier 3', resolve({ id: 'p2', company: 'Triumph Group' })), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
