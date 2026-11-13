// Assertion tests for the company popup's Targets tab storage helpers.
// Plain Node, no framework. Run:
//   node scripts/companyTargets.test.mjs
import { normalizeTargets, updateTarget, removeTarget, cleanYear, blankTarget, scopesLabel } from '../src/utils/companyTargets.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

check('normalize: not an array', normalizeTargets(null), []);
check('normalize: fills blanks, drops junk', normalizeTargets([{ id: 'a', type: 'Net zero', baseYear: 2019 }, null, 'x']), [
  { id: 'a', type: 'Net zero', baseYear: '2019', targetYear1: '', targetYear2: '', scope1: false, scope2: false, scope3: false },
]);
check('cleanYear: digits only, four max', [cleanYear('20a305'), cleanYear(''), cleanYear(null)], ['2030', '', '']);
const list = [{ id: 'a', type: '' }, { id: 'b', type: 'SBTi' }];
const edited = updateTarget(list, 'a', 'targetYear1', '2030x');
check('update: year cleaned, other row untouched', [edited[0].targetYear1, edited[1].type], ['2030', 'SBTi']);
check('update: scope flag', updateTarget(list, 'b', 'scope3', 1)[1].scope3, true);
check('remove', removeTarget(list, 'a').map(r => r.id), ['b']);
const b = blankTarget();
check('blank: has id and empty fields', [!!b.id, b.type, b.scope1], [true, '', false]);
check('scopesLabel', [scopesLabel({ scope1: true, scope3: true }), scopesLabel({})], ['1, 3', '']);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll company targets tests passed.');
