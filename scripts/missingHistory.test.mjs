// Assertion tests for the My Accounts "All Missing History" subtab
// (src/utils/missingHistory.js). Plain Node, no framework. Run:
//   node scripts/missingHistory.test.mjs
//
// The claims:
//   1. A reading sums every Company Data field's missing count, and is null
//      when there are no companies to read.
//   2. The first reading on record is also logged as the day before.
//   3. After that a day is rewritten only when its numbers move.
import { missingReading, withMissingDay, previousDay } from '../src/utils/missingHistory.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// 1
const r = missingReading([
  { numberOfSites: 10, numberOfAccounts: 0, website: 'a.com' },
  { numberOfSites: '', zoomCompanyId: '  ' },
]);
check('sites missing once', r.fields.numberOfSites, 1);
check('0 is an answer', r.fields.numberOfAccounts, 1);
check('blank text is missing', r.fields.zoomCompanyId, 2);
check('total is the sum of the fields', r.total, Object.values(r.fields).reduce((a, b) => a + b, 0));
check('total', r.total, 1 + 1 + 2 + 2 + 2 + 2 + 2 + 1);
check('companies', r.companies, 2);
check('nothing to read', missingReading([]), null);

// 2
check('previous day across a month', previousDay('2026-10-01'), '2026-09-30');
const first = withMissingDay({}, '2026-10-15', { total: 5, fields: {}, companies: 1 }, 1);
check('first reading logs today and yesterday', Object.keys(first).sort(), ['2026-10-14', '2026-10-15']);
check('yesterday carries the same number', first['2026-10-14'].total, 5);
check('yesterday is marked seeded', first['2026-10-14'].seeded, true);

// 3
const same = withMissingDay(first, '2026-10-15', { total: 5, fields: {}, companies: 1 }, 2);
check('unchanged reading writes nothing', same === first, true);
const moved = withMissingDay(first, '2026-10-15', { total: 3, fields: {}, companies: 1 }, 3);
check('a changed reading rewrites today', moved['2026-10-15'].total, 3);
check('yesterday is left alone', moved['2026-10-14'].total, 5);
const tomorrow = withMissingDay(moved, '2026-10-16', { total: 2, fields: {}, companies: 1 }, 4);
check('a later day does not reseed', Object.keys(tomorrow).sort(), ['2026-10-14', '2026-10-15', '2026-10-16']);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
