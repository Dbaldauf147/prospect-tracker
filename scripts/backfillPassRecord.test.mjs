// Assertion tests for where the one-time prospect backfills record that
// they've run. Plain Node - no test framework (the project has none). Run:
//   node scripts/backfillPassRecord.test.mjs
//
// A pass writes fixed values onto companies. Run twice, it puts them back
// onto companies the user has changed since, so "has it run?" must come
// from the account, and a browser that ran it before the record moved there
// must not let the next browser run it again.
import { planBackfillPasses, BACKFILLS_DONE_KEY } from '../src/utils/backfillPassRecord.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}

const PASSES = [{ flag: 'owner-pass' }, { flag: 'firm-pass' }];
const NOW = '2026-10-26T15:00:00.000Z';
const noLocal = () => null;

{
  const { pending, record } = planBackfillPasses(PASSES, {}, noLocal, NOW);
  eq(pending.map(p => p.flag), ['owner-pass', 'firm-pass'], 'a new account runs every pass');
  eq(record, { [`${BACKFILLS_DONE_KEY}.owner-pass`]: NOW, [`${BACKFILLS_DONE_KEY}.firm-pass`]: NOW },
    'and records each as done in the account');
}
{
  // The case this exists for: site data cleared, the account says it ran.
  const settings = { [BACKFILLS_DONE_KEY]: { 'owner-pass': '2026-06-01', 'firm-pass': '2026-06-12' } };
  const { pending, record } = planBackfillPasses(PASSES, settings, noLocal, NOW);
  eq(pending, [], 'a cleared browser runs nothing the account has already run');
  eq(record, {}, 'and has nothing to record');
}
{
  // This browser ran them before the record moved: copy its stamps up.
  const local = { 'owner-pass': '2026-06-01T09:00:00Z' };
  const { pending, record } = planBackfillPasses(PASSES, {}, (f) => local[f] || null, NOW);
  eq(pending.map(p => p.flag), ['firm-pass'], 'a pass this browser already ran is not run again');
  eq(record[`${BACKFILLS_DONE_KEY}.owner-pass`], '2026-06-01T09:00:00Z', 'its local stamp goes to the account');
  eq(record[`${BACKFILLS_DONE_KEY}.firm-pass`], NOW, 'the one that runs now is recorded as of now');
}
{
  const { pending } = planBackfillPasses(PASSES, {}, () => { throw new Error('blocked'); }, NOW);
  eq(pending.length, 2, 'unreadable local storage reads as not run here, not as a crash');
  eq(planBackfillPasses(undefined, {}, noLocal, NOW), { pending: [], record: {} }, 'no passes, nothing to do');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
