// Assertion tests for the choices the Vertical conflict popup offers.
// Plain Node, no test framework. Run:
//   node scripts/verticalConflictChoices.test.mjs
import { verticalConflictChoices } from '../src/utils/verticalConflictChoices.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const ids = (c, s) => verticalConflictChoices(c, s).map(x => x.id);
const conflict = { company: 'Principal', cardVertical: 'Investment Managers', listVertical: 'Investment Management', source: 'Principal Real Estate Investors', onList: false };

check('card against list', ids(conflict, null), ['targets', 'card', 'same']);
check('a third opinion sits before the mapping', ids(conflict, { vertical: 'Asset Management' }), ['targets', 'card', 'suggested', 'same']);
check('a suggestion that repeats a side is not a third choice', ids(conflict, { vertical: 'investment managers' }), ['targets', 'card', 'same']);
check('no card vertical: nothing to keep or map', ids({ ...conflict, cardVertical: '' }, null), ['targets']);
check('values shown', verticalConflictChoices(conflict, null).map(x => x.value),
  ['Investment Management', 'Investment Managers', 'Investment Management = Investment Managers']);
check('off-list note', /not on your Dropdowns/.test(verticalConflictChoices(conflict, null)[0].detail), true);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
