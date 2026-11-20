// Assertion tests for the Variable Coverage table's sorting.
// Plain Node, no test framework. Run:
//   node scripts/coverageSort.test.mjs
import { sortCoverageRows, nextCoverageSort } from '../src/utils/coverageSort.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const rows = [
  { n: 'Scott', co: 'Monroe Capital' },
  { n: 'alex', co: 'Nuveen' },
  { n: 'Jennie', co: '' },
  { n: 'Brendan', co: 'nuveen' },
  { n: 'Karina', co: 'Monroe Capital' },
];
const val = (r, k) => r[k];
const names = (sort) => sortCoverageRows(rows, sort, val).map(r => r.n);

check('no sort keeps the order added', names(null), ['Scott', 'alex', 'Jennie', 'Brendan', 'Karina']);
check('A to Z, case ignored', names({ key: 'n', dir: 1 }), ['alex', 'Brendan', 'Jennie', 'Karina', 'Scott']);
check('Z to A', names({ key: 'n', dir: -1 }), ['Scott', 'Karina', 'Jennie', 'Brendan', 'alex']);
check('blanks last, ties in the order added', names({ key: 'co', dir: 1 }), ['Scott', 'Karina', 'alex', 'Brendan', 'Jennie']);
check('blanks still last going down', names({ key: 'co', dir: -1 }), ['alex', 'Brendan', 'Scott', 'Karina', 'Jennie']);
check('the input is not reordered', rows.map(r => r.n), ['Scott', 'alex', 'Jennie', 'Brendan', 'Karina']);

check('first click sorts A to Z', nextCoverageSort(null, 'n'), { key: 'n', dir: 1 });
check('second click flips', nextCoverageSort({ key: 'n', dir: 1 }, 'n'), { key: 'n', dir: -1 });
check('third click clears', nextCoverageSort({ key: 'n', dir: -1 }, 'n'), null);
check('another column starts over', nextCoverageSort({ key: 'n', dir: -1 }, 'co'), { key: 'co', dir: 1 });

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
