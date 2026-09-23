// Assertion tests for DataTable's row key. Plain Node. Run:
//   node scripts/tableRowKey.test.mjs
//
// A row without an `id` must never share a key with a row that has one.
// Opp ids are small integers and React stringifies keys, so a position
// fallback of 57 collided with opp 57 and left a dead duplicate of that
// opp on the Opps table.
import { tableRowKey } from '../src/utils/tableRowKey.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

check('uses id when present', tableRowKey({ id: 7, _id: 7 }, 3), 7);
check('falls back to _id', tableRowKey({ _id: 'sched:abc' }, 3), 'sched:abc');
check('position key is namespaced', tableRowKey({}, 3), '__pos:3');
check('id 0 is kept', tableRowKey({ id: 0 }, 5), 0);

// The regression: a table mixing numeric-id rows with id-less rows.
const rows = Array.from({ length: 60 }, (_, i) => ({ id: i + 1 }));
rows.splice(20, 0, { _id: 'sched:1' }, {});
const keys = rows.map((r, i) => String(tableRowKey(r, i)));
check('no duplicate keys', new Set(keys).size, keys.length);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall passed');
