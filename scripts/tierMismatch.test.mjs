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

// The tier column is the one the Targets page reads, not the first filled
// cell under any "tier"/"target" header: an earlier "Target Segment" or
// "Prior Tier" column must not hide the Tier the page shows.
for (const [label, rec, headers] of [
  ['a filled "Target Segment" column first',
    { 'Account Name': 'Triumph Group', 'Target Segment': 'Aerospace', 'Account Tier': '3' },
    ['Account Name', 'Target Segment', 'Account Tier']],
  ['a "Prior Tier" column saying Not on tier list first',
    { 'Account Name': 'Triumph Group', 'Prior Tier': 'Not on tier list', Tier: 'Tier 3' },
    ['Account Name', 'Prior Tier', 'Tier']],
  ['a plain digit in the Tier column',
    { 'Account Name': 'Triumph Group', Targeted: 'Yes', Tier: '3' },
    ['Account Name', 'Targeted', 'Tier']],
]) {
  const data = { sheetNames: ['S'], sheets: { S: { headers, records: [rec] } } };
  const settings = { targetMap: { p1: ['Triumph Group'] } };
  check(`${label}: box reads Tier 3`, targetAccountRows(data, settings)[0]?.tier, 'Tier 3');
  const resolve = buildTargetTierResolver({ targetAccountsData: data, cdmName: 'Dan Baldauf', settings, includeAllReps: true });
  check(`${label}: warning reads Tier 3`, resolve({ id: 'p1', company: 'Triumph Group' }).tier, 'Tier 3');
}

// Triumph Group again: listed twice, the first row untiered. The box and
// the warning both take the tiered row, the one the Targets page shows.
{
  const data = { sheetNames: ['All', 'Mine'], sheets: {
    All: { headers: ['Account Name', 'CDM', 'Tier'], records: [{ 'Account Name': 'Triumph Group', CDM: 'Other Rep', Tier: '' }] },
    Mine: { headers: ['Account Name', 'CDM', 'Tier'], records: [{ 'Account Name': 'Triumph Group', CDM: 'Dan Baldauf', Tier: 'Tier 3' }] },
  } };
  const settings = { targetMap: { p1: ['Triumph Group'] } };
  const rows = targetAccountRows(data, settings);
  check('duplicate name: one row in the box', rows.length, 1);
  check('duplicate name: the tiered row wins', [rows[0].tier, rows[0].cdm, rows[0].sheet], ['Tier 3', 'Dan Baldauf', 'Mine']);
  const resolve = buildTargetTierResolver({ targetAccountsData: data, cdmName: 'Dan Baldauf', settings, includeAllReps: true });
  check('duplicate name: warning agrees', tierMismatch('Tier 3', resolve({ id: 'p1', company: 'Triumph Group' })), null);
  const same = { sheetNames: ['S'], sheets: { S: { headers: ['Account Name', 'Tier'], records: [
    { 'Account Name': 'Triumph Group', Tier: '' }, { 'Account Name': 'Triumph Group', Tier: '3' },
  ] } } };
  check('listed twice on one sheet: tiered row wins', targetAccountRows(same, {})[0].tier, 'Tier 3');
  const both = { sheetNames: ['S'], sheets: { S: { headers: ['Account Name', 'Tier', 'Tier'], records: [
    { 'Account Name': 'A', Tier: '1' }, { 'Account Name': 'A', Tier: '2' },
  ] } } };
  check('both tiered: first row still wins', targetAccountRows(both, {})[0].tier, 'Tier 1');
}

// Two tier columns: a blank "Account Tier" must not hide "Tier".
{
  const data = { sheetNames: ['S'], sheets: { S: {
    headers: ['Account Name', 'Account Tier', 'Prior Tier', 'Tier'],
    records: [{ 'Account Name': 'Triumph Group', 'Account Tier': '', 'Prior Tier': '2', Tier: '3' }],
  } } };
  check('blank Account Tier: falls to Tier, ahead of Prior Tier', targetAccountRows(data, {})[0].tier, 'Tier 3');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
