// Assertion tests for the Days in My Accounts column's record
// (utils/myAccountsSince.js). Plain Node. Run:
//   node scripts/myAccountsSince.test.mjs
import {
  withMyAccountsStamped, mergeMyAccountsSince, daysBetween, sinceFor, createdDay, parseMyAccountsSince,
} from '../src/utils/myAccountsSince.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// First day: accounts already here are backdated to createdAt, marked est.
let s = withMyAccountsStamped(null, [
  { company: 'Acme Corp', createdAt: '2026-03-01T15:00:00' },
  { company: 'Beta Holdings', createdAt: { seconds: Date.UTC(2026, 5, 10, 12) / 1000 } },
  { company: 'Cobalt Inc' },
], '2026-10-30');
eq(s.startedOn, '2026-10-30', 'first run records the start day');
eq(sinceFor(s, 'Acme Corp'), { since: '2026-03-01', company: 'Acme Corp', est: true }, 'backfill uses createdAt (ISO)');
eq(sinceFor(s, 'Beta Holdings')?.since, '2026-06-10', 'backfill uses createdAt ({ seconds })');
eq(sinceFor(s, 'Cobalt Inc'), { since: '2026-10-30', company: 'Cobalt Inc' }, 'no createdAt -> today');
eq(sinceFor(s, 'acme corp.')?.since, '2026-03-01', 'lookup goes by dedupe key');

// Same day, nothing new: same object back so the caller skips the write.
eq(withMyAccountsStamped(s, [{ company: 'Acme Corp' }], '2026-10-30') === s, true, 'unchanged store returned as-is');

// Later day: a new arrival is stamped with that day even if long in the tracker.
const s2 = withMyAccountsStamped(s, [{ company: 'Delta Partners', createdAt: '2025-01-01T00:00:00' }], '2026-11-04');
eq(sinceFor(s2, 'Delta Partners'), { since: '2026-11-04', company: 'Delta Partners' }, 'post-backfill arrival -> that day');
eq(sinceFor(s2, 'Acme Corp')?.since, '2026-03-01', 'an account absent from a run keeps its date');

// Merge keeps the earliest date per account and the earliest start.
const m = mergeMyAccountsSince(
  { startedOn: '2026-11-01', accounts: { x: { since: '2026-11-01', company: 'X' }, y: { since: '2026-10-01', company: 'Y', est: true } } },
  { startedOn: '2026-10-30', accounts: { x: { since: '2026-10-30', company: 'X' }, y: { since: '2026-10-01', company: 'Y' } } },
);
eq(m.startedOn, '2026-10-30', 'merge keeps earliest start');
eq(m.accounts.x.since, '2026-10-30', 'merge keeps earliest date');
eq(m.accounts.y, { since: '2026-10-01', company: 'Y' }, 'tie prefers recorded over estimate');

eq(daysBetween('2026-10-01', '2026-10-30'), 29, 'days between');
eq(daysBetween('2026-03-07', '2026-03-09'), 2, 'days across a DST change');
eq(daysBetween('', '2026-10-30'), null, 'no date -> null');
eq(createdDay('nonsense'), '', 'bad createdAt -> empty');
eq(parseMyAccountsSince('not json'), { startedOn: '', accounts: {} }, 'bad raw -> empty store');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
