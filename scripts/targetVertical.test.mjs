// Assertion tests for importing a company's vertical from the Target
// Accounts list (targetVerticalFor in src/utils/targetTier.js). Run:
//   node scripts/targetVertical.test.mjs
import { targetVerticalFor, resolveTargetAccountVertical, renameTargetVertical, targetVerticalAgrees, targetVerticalEquivalentsOf, withTargetVerticalEquivalent, suggestTargetVertical } from '../src/utils/targetTier.js';
import { targetAccountRows, targetRowFlags, targetAcceptPatch } from '../src/utils/targetAccountMatch.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const data = { sheetNames: ['A', 'B'], sheets: {
  A: { records: [
    { 'Account Name': 'Acme Holdings', Industry: 'real estate', Tier: '1' },
    { 'Account Name': 'Blank Co', Industry: '', Tier: '2' },
  ] },
  B: { records: [{ 'Account Name': 'Zed Inc', 'Sub Vertical': 'Hotels', Vertical: 'Hospitality' }] },
} };
const options = ['Real Estate', 'Hotels', 'Grocery'];
const run = (targetMap, id = 'p1', extra = {}) =>
  targetVerticalFor({ targetAccountsData: data, settings: { targetMap, ...extra }, prospectId: id, options });

check('not mapped: nothing to import', run({}), null);
check('mapping cleared: nothing to import', run({ p1: [] }), null);
check('no id (new company): nothing', run({ p1: ['Acme Holdings'] }, null), null);
check('mapped: the row\'s vertical, snapped to the list\'s spelling',
  run({ p1: ['Acme Holdings'] }), { name: 'Acme Holdings', vertical: 'Real Estate', onList: true });
check('a single mapped name (not an array) works too', run({ p1: 'Acme Holdings' })?.vertical, 'Real Estate');
check('mapped name matched ignoring case', run({ p1: ['acme holdings'] })?.vertical, 'Real Estate');
check('mapped to a row with no vertical', run({ p1: ['Blank Co'] }), { name: 'Blank Co', vertical: '', onList: false });
check('first mapped name that has one wins', run({ p1: ['Blank Co', 'Acme Holdings'] })?.name, 'Acme Holdings');
check('auto prefers a header that is exactly Vertical over Sub Vertical',
  run({ p1: ['Zed Inc'] }), { name: 'Zed Inc', vertical: 'Hospitality', onList: false });
check('a picked column wins over the guess',
  run({ p1: ['Zed Inc'] }, 'p1', { targetVerticalColumn: 'Sub Vertical' }), { name: 'Zed Inc', vertical: 'Hotels', onList: true });
check('a picked column the row\'s sheet lacks falls back to the guess (Tier 3 tab)', resolveTargetAccountVertical({ Industry: 'X' }, 'Vertical'), 'X');
check('a picked column that is blank on the row falls back to the guess', resolveTargetAccountVertical({ Vertical: '', Industry: 'X' }, 'Vertical'), 'X');
check('a blank exact Vertical header falls through to a filled Industry with no pick', resolveTargetAccountVertical({ Vertical: '', Industry: 'X' }), 'X');
check('a filled picked column still wins over the guess', resolveTargetAccountVertical({ Vertical: 'V', Industry: 'X' }, 'Vertical'), 'V');
check('picked and every vertical-like cell blank reads blank', resolveTargetAccountVertical({ Vertical: '', Industry: '' }, 'Vertical'), '');
{
  // The reported shape: one tab, Vertical picked, Tier 1/2 rows fill it and
  // Tier III rows leave it blank with the vertical under another header.
  const sameTab = { sheetNames: ['Targets'], sheets: { Targets: { records: [
    { 'Account Name': 'Big Co', Tier: 'Tier 1', Vertical: 'Grocery', Segment: '' },
    { 'Account Name': 'Small Co', Tier: 'Tier III', Vertical: '', Segment: 'hotels' },
  ] } } };
  check('mapped Tier III row with a blank Vertical imports from its other vertical column',
    targetVerticalFor({ targetAccountsData: sameTab, settings: { targetMap: { p: ['Small Co'] }, targetVerticalColumn: 'Vertical' }, prospectId: 'p', options }),
    { name: 'Small Co', vertical: 'Hotels', onList: true });
  check('the popup box row carries it too',
    targetAccountRows(sameTab, { targetVerticalColumn: 'Vertical' }).find(r => r.name === 'Small Co')?.vertical, 'hotels');
}
{
  const tiered = { sheetNames: ['Tier 1-2', 'Tier 3'], sheets: {
    'Tier 1-2': { records: [{ 'Account Name': 'Acme Holdings', Vertical: 'Grocery', Tier: '2' }] },
    'Tier 3': { records: [{ Company: 'Tri Corp', Industry: 'hotels', 'Account Tier': 'Tier 3' }] },
  } };
  check('picked column on the Tier 1/2 tab still imports from the Tier 3 tab',
    targetVerticalFor({ targetAccountsData: tiered, settings: { targetMap: { p1: ['Tri Corp'] }, targetVerticalColumn: 'Vertical' }, prospectId: 'p1', options }),
    { name: 'Tri Corp', vertical: 'Hotels', onList: true });
}
check('no record, no vertical', resolveTargetAccountVertical(null), '');

// Target Accounts > Vertical names: the user's own name for a list vertical.
{
  const names = { targetVerticalNames: { 'real estate': 'Grocery', hospitality: '  ' } };
  check('renamed vertical is imported under the user\'s name, snapped to the list',
    run({ p1: ['Acme Holdings'] }, 'p1', names), { name: 'Acme Holdings', vertical: 'Grocery', onList: true });
  check('a blank rename keeps the list\'s spelling', run({ p1: ['Zed Inc'] }, 'p1', names)?.vertical, 'Hospitality');
  check('rename matched ignoring case', renameTargetVertical('REAL ESTATE', names), 'Grocery');
  check('no mapping: unchanged', renameTargetVertical('Retail', names), 'Retail');
  check('popup Target Accounts box shows the renamed vertical',
    targetAccountRows(data, names).find(r => r.name === 'Acme Holdings')?.vertical, 'Grocery');
}

// Verticals mapped as the same (targetVerticalEquivalents).
{
  let map = withTargetVerticalEquivalent(undefined, 'Investment Management', 'Private Equity');
  map = withTargetVerticalEquivalent(map, 'investment management', 'Asset Management');
  map = withTargetVerticalEquivalent(map, 'Investment Management', 'private equity');
  check('equivalents: keyed lower-case, no case-repeats', map, { 'investment management': ['Asset Management', 'private equity'] });
  const settings = { targetVerticalEquivalents: map };
  check('equivalents of', targetVerticalEquivalentsOf('INVESTMENT MANAGEMENT', settings), ['Asset Management', 'private equity']);
  check('agrees: mapped pair', targetVerticalAgrees('Investment Management', 'Private Equity', settings), true);
  check('agrees: same, ignoring case', targetVerticalAgrees('Retail', 'retail', null), true);
  check('agrees: unmapped pair', targetVerticalAgrees('Investment Management', 'Retail', settings), false);
  check('agrees: mapping is one way', targetVerticalAgrees('Private Equity', 'Investment Management', settings), false);
  check('agrees: blank card is not a match', targetVerticalAgrees('Investment Management', '', settings), false);
  const row = { name: 'CBRE IM', cdm: '', tier: '', vertical: 'Investment Management' };
  check('row flags: mapped vertical is not flagged', targetRowFlags(row, { vertical: 'Private Equity' }, [], settings).vertical, null);
  check('row flags: unmapped still flagged', !!targetRowFlags(row, { vertical: 'Retail' }, [], settings).vertical, true);
  check('row flags: no settings, flagged as before', !!targetRowFlags(row, { vertical: 'Private Equity' }, []).vertical, true);
  check('accept patch leaves a mapped vertical alone', targetAcceptPatch(row, { vertical: 'Private Equity' }, { settings }), {});
  const index = new Map([['cbre im', 'Investment Management']]);
  check('My Accounts suggestion: none for a mapped pair', suggestTargetVertical({ targetNames: ['CBRE IM'], vertical: 'Private Equity', index, settings }), null);
  check('My Accounts suggestion: still for an unmapped one', suggestTargetVertical({ targetNames: ['CBRE IM'], vertical: 'Retail', index, settings })?.vertical, 'Investment Management');
  const removed = withTargetVerticalEquivalent(withTargetVerticalEquivalent(map, 'Investment Management', 'Asset Management', { remove: true }), 'Investment Management', 'Private Equity', { remove: true });
  check('remove: emptied entry dropped', removed, {});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
