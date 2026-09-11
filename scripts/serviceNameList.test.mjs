// Assertion tests for reading a list of service names whose names contain
// commas. Plain Node — no test framework (the project has none). Run:
//   node scripts/serviceNameList.test.mjs
//
// The bug being pinned: "Cat 3, 5, 6, and 7 (part of GHG)" is ONE service in
// the user's Solutions list, and the Services tab stores its list cells
// comma-separated. Splitting on every comma turned one pick into four
// fragments that match no service — the cell showed a struck-through
// "Cat 3" and a "+3", and reopening the picker showed nothing ticked.
import { splitServiceNames, joinServiceNames } from '../src/utils/serviceNameList.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const CAT = 'Cat 3, 5, 6, and 7 (part of GHG)';
const known = ['GHG', 'Comp GHG', CAT, 'Cat 1 & 2', 'Budgets', 'AP upload (indirect payment)'];

// Without a vocabulary there is nothing to disambiguate with, so it stays the
// plain comma split it replaces.
check('no known names, plain split', splitServiceNames('GHG, Budgets'), ['GHG', 'Budgets']);
check('nothing at all', splitServiceNames('', known), []);
check('undefined', splitServiceNames(undefined, known), []);
check('an array passes through', splitServiceNames([' GHG ', '', 'Budgets'], known), ['GHG', 'Budgets']);

// The fix itself.
check('a name with commas survives', splitServiceNames(CAT, known), [CAT]);
check(
  'and alongside its neighbours',
  splitServiceNames(`GHG, ${CAT}, Budgets`, known),
  ['GHG', CAT, 'Budgets'],
);
check(
  'two of them in a row',
  splitServiceNames(`${CAT}, ${CAT}`, known),
  [CAT, CAT],
);
// Longest run wins: the fragments of a comma name are not services, but even
// where one is, the whole name is what was picked.
check(
  'the whole name beats a fragment of it',
  splitServiceNames(CAT, [...known, 'Cat 3']),
  [CAT],
);

// Spacing and casing drift in a hand-typed cell.
check('spacing forgiven', splitServiceNames('Cat 3,5,   6, and 7 (part of GHG)', known), [CAT]);
check('casing resolved to the list', splitServiceNames('ghg, budgets', known), ['GHG', 'Budgets']);

// A name that is not a service is kept as typed — that is what the cell
// renders as stale, which is how a retired service stays visible.
check('an unknown name is kept', splitServiceNames('Retired thing, GHG', known), ['Retired thing', 'GHG']);
check(
  'an unknown fragment is not invented into a service',
  splitServiceNames('Cat 3, 5', known),
  ['Cat 3', '5'],
);

// Commas in a name that is not the longest match.
check(
  'a plain name containing no comma is untouched',
  splitServiceNames('AP upload (indirect payment), GHG', known),
  ['AP upload (indirect payment)', 'GHG'],
);

// Blank segments don't produce entries.
check('blank segments dropped', splitServiceNames('GHG, , Budgets,', known), ['GHG', 'Budgets']);

// Round trip: what the pickers write is what this reads back.
check('round trip', splitServiceNames(joinServiceNames(['GHG', CAT]), known), ['GHG', CAT]);
check('join trims and drops blanks', joinServiceNames([' GHG ', '', 'Budgets']), 'GHG, Budgets');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
