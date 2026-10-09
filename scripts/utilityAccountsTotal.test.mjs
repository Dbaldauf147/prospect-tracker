// The utility accounts total on the Master Analysis Site Detail sheets:
// the typed (actual) total wins, else the per-site estimates summed.
// Plain Node. Run:
//   node scripts/utilityAccountsTotal.test.mjs
import { utilityAccountsTotal } from '../src/utils/utilityAccountsTotal.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('typed total wins', utilityAccountsTotal(140, [3, 4]), { value: 140, entered: true, label: 'Utility accounts (actual, entered)' });
check('typed zero is still an answer', utilityAccountsTotal(0, [3])?.value, 0);
check('no typed total: estimates summed', utilityAccountsTotal(null, [3, 4, null, 2.5]), { value: 10, entered: false, label: 'Est. utility accounts (total)' });
check('half accounts round', utilityAccountsTotal(null, [0.5, 0.5, 0.5])?.value, 2);
check('nothing to add up', utilityAccountsTotal(null, [null, undefined]), null);
check('no sites', utilityAccountsTotal(null, []), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
