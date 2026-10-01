// Assertion tests for the Services subtab's Completed marks.
// Plain Node - no test framework. Run:
//   node scripts/servicesCompleted.test.mjs
import { mergeCompletedServices } from '../src/utils/servicesCompleted.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const wb = { options: [
  { sheetName: 'Option 1', servicesCompleted: ['Bill payment', 'ESPM link'] },
  { sheetName: 'Option 2', servicesCompleted: ['  bill PAYMENT ', 'Budgets (account level)'] },
  { sheetName: 'Option 3' },
] };

check('old marks on the workbook join the list',
  mergeCompletedServices(['rate optimization'], wb),
  ['rate optimization', 'bill payment', 'espm link', 'budgets (account level)']);
check('no saved list yet', mergeCompletedServices(undefined, wb), ['bill payment', 'espm link', 'budgets (account level)']);
check('nothing new: null', mergeCompletedServices(['bill payment', 'espm link', 'budgets (account level)'], wb), null);
check('no workbook: null', mergeCompletedServices(['bill payment'], null), null);
check('workbook with no marks: null', mergeCompletedServices([], { options: [{}] }), null);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
