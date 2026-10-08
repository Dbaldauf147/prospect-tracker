// Assertion tests for importing a company's vertical from the Target
// Accounts list (targetVerticalFor in src/utils/targetTier.js). Run:
//   node scripts/targetVertical.test.mjs
import { targetVerticalFor, resolveTargetAccountVertical } from '../src/utils/targetTier.js';

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
check('a picked column the row lacks reads blank', resolveTargetAccountVertical({ Industry: 'X' }, 'Vertical'), '');
check('no record, no vertical', resolveTargetAccountVertical(null), '');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
