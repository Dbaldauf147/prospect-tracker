// Assertion tests for the company popup's Tier warning
// (tierMismatch in src/utils/targetTier.js). Plain Node. Run:
//   node scripts/tierMismatch.test.mjs
import { tierMismatch, buildTargetTierResolver } from '../src/utils/targetTier.js';
import { targetAccountRows } from '../src/utils/targetAccountMatch.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const t = (tier) => ({ tier, name: 'Acme', source: 'fuzzy' });

check('list not loaded: no warning', tierMismatch('Tier 1', null), null);
check('same tier: no warning', tierMismatch('Tier 2', t('Tier 2')), null);
check('different tier warns, and applies the list',
  tierMismatch('Tier 3', t('Tier 1')), { cardTier: 'Tier 3', targetTier: 'Tier 1', apply: 'Tier 1' });
check('blank card on a tiered company warns', tierMismatch('', t('Tier 2'))?.apply, 'Tier 2');
check('"-" is blank too', tierMismatch('-', t('Tier 2'))?.cardTier, '');
check('blank card, untiered company: fine', tierMismatch('', t('')), null);
check('Not on tier list, untiered company: fine', tierMismatch('Not on tier list', t('')), null);
check('Not on tier list on a tiered company warns', tierMismatch('Not on tier list', t('Tier 1'))?.targetTier, 'Tier 1');
check('a tier on an untiered company warns, and applies Not on tier list',
  tierMismatch('Tier 1', t('')), { cardTier: 'Tier 1', targetTier: '', apply: 'Not on tier list' });


// The popup's Targets list box and its Tier warning read the same row the
// same way. A blank column whose header reads like a name ("Account ID")
// ahead of "Account Name" used to make the warning's reader skip the row,
// so the box said Tier 3 while the warning said Not on tier list.
{
  const data = { sheetNames: ['S'], sheets: { S: { records: [
    { 'Account ID': '', 'Account Name': 'Triumph Group', 'Target Notes': '', Tier: 'Tier 3', CDM: 'Someone Else' },
  ] } } };
  const settings = { targetMap: { p1: ['Triumph Group'] } };
  const box = targetAccountRows(data, settings).find(r => r.name === 'Triumph Group');
  check('box reads Tier 3', box?.tier, 'Tier 3');
  const resolve = buildTargetTierResolver({ targetAccountsData: data, cdmName: 'Dan Baldauf', settings, includeAllReps: true });
  check('mapped warning reads Tier 3 too', resolve({ id: 'p1', company: 'Triumph Group' }).tier, 'Tier 3');
  check('unmapped name match reads Tier 3 too', resolve({ id: 'p2', company: 'Triumph Group' }).tier, 'Tier 3');
  check('card at Tier 3 agrees', tierMismatch('Tier 3', resolve({ id: 'p1', company: 'Triumph Group' })), null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
