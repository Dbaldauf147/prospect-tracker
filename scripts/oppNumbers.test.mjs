// Assertion tests for the shared "Opp #" ranking. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/oppNumbers.test.mjs
//
// The number is a rank, not a stored field, so what's worth holding is that
// it counts 1..N with no gaps whatever order the records arrive in — the
// Opps tab and the Issues tab rank the same list independently and have to
// land on the same answer.
import { buildOppNumberMap } from '../src/utils/oppNumbers.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const map = buildOppNumberMap([{ _id: 30 }, { _id: 4 }, { _id: 17 }]);
check('the lowest id is #1', map.get(4), 1);
check('then the next', map.get(17), 2);
check('then the next', map.get(30), 3);
check('an unknown id has no number', map.get(99), undefined);

// Deleted rows leave gaps in `_id`; the rank closes them, which is the
// whole reason the number isn't just the id.
const sparse = buildOppNumberMap([{ _id: 1 }, { _id: 900 }]);
check('gaps in the ids do not become gaps in the numbers', sparse.get(900), 2);

// Ids arrive as numbers, but a cached row can carry a numeric string.
const mixed = buildOppNumberMap([{ _id: '10' }, { _id: 9 }]);
check('a numeric string sorts by value, not lexically', mixed.get(9), 1);
check('and still gets its own rank', mixed.get('10'), 2);

const skipped = buildOppNumberMap([{ _id: null }, {}, { _id: 5 }, null]);
check('rows with no id are skipped', skipped.size, 1);
check('and the rest still start at 1', skipped.get(5), 1);
check('a junk record list yields an empty map', buildOppNumberMap(null).size, 0);

console.log(failures === 0 ? '\nAll oppNumbers tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
