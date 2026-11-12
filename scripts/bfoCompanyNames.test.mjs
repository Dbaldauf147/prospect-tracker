// Assertion tests for a company's BFO names (primary + others). Plain Node.
//   node scripts/bfoCompanyNames.test.mjs
import { bfoCompanyNamesOf, splitBfoNames } from '../src/utils/bfoCompanyNames.js';
import { bfoHistoryTargets, bfoHistoryMissingNameIssues } from '../src/utils/bfoHistory.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

check('split: lines and semicolons, blanks dropped', splitBfoNames('A\n B ;; C\n'), ['A', 'B', 'C']);
check('names: primary only', bfoCompanyNamesOf({ bfoCompanyName: ' CBRE ' }), ['CBRE']);
check('names: primary then others, no repeats', bfoCompanyNamesOf({ bfoCompanyName: 'CBRE', bfoCompanyAltNames: 'cbre\nCBRE Investment Management' }), ['CBRE', 'CBRE Investment Management']);
check('names: others without a primary', bfoCompanyNamesOf({ bfoCompanyAltNames: 'X Corp' }), ['X Corp']);
check('names: none', bfoCompanyNamesOf({}), []);

// BFO History: several names go into the prompt row, and a company with
// only "other" names isn't reported as missing.
const p1 = { id: '1', company: 'CBRE', bfoCompanyName: 'CBRE', bfoCompanyAltNames: 'CBRE IM' };
const p2 = { id: '2', company: 'Alt Only', bfoCompanyAltNames: 'Alt Only LLC' };
const targets = bfoHistoryTargets([{ contact: 1 }, { contact: 2 }], c => (c === 1 ? p1 : p2));
check('history targets join every name', targets.map(t => t.bfoCompanyName), ['Alt Only LLC', 'CBRE; CBRE IM']);
check('alt-only company is not missing', bfoHistoryMissingNameIssues(targets), []);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed');
