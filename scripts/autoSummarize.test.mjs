// Assertion tests for the auto-summarize queue — which transcribed calls a
// background pass pays to summarise while nobody is watching. Plain Node, no
// test framework (the project has none). Run:
//   node scripts/autoSummarize.test.mjs
//
// Every call this returns costs a real API call made unattended, so the
// properties worth pinning are the ones that spend money wrongly: a call
// that is already summarised, one the user has ruled out as N/A, one whose
// transcript the summariser keeps choking on, and a first run against a
// long back-fill trying to do the lot in one burst.
import {
  isDueForAutoSummary, callsDueForAutoSummary, autoSummaryFailurePatch,
  autoSummaryGaveUp, AUTO_SUMMARY_MAX_ATTEMPTS, AUTO_SUMMARY_PER_RUN,
} from '../src/utils/autoSummarize.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
function ok(label, cond) { check(label, !!cond, true); }

const call = (over = {}) => ({
  id: 'c1', transcript: 'we talked about the RFP', recordedAt: '2026-09-04T10:00:00Z', ...over,
});

// ── What qualifies ────────────────────────────────────────────────────────
ok('due: transcribed, unsummarised, untagged', isDueForAutoSummary(call()));
ok('due: tagged to an opp', isDueForAutoSummary(call({ oppId: 'opp-1', oppLabel: 'Ventas RFP' })));

check('not due: no transcript', isDueForAutoSummary(call({ transcript: '' })), false);
check('not due: whitespace transcript', isDueForAutoSummary(call({ transcript: '   \n' })), false);
check('not due: already summarised', isDueForAutoSummary(call({ summarizedAt: '2026-09-04T11:00:00Z' })), false);
// A record carrying a summary but no timestamp (an older write) is still done.
check('not due: has a summary without a stamp', isDueForAutoSummary(call({ summary: 'They want pricing.' })), false);
check('not due: nothing at all', isDueForAutoSummary(null), false);

// ── N/A is a decision, and it is "no" ─────────────────────────────────────
// A call the user marked as belonging to no deal — an internal 1:1, a
// prospecting block Granola sat in. The button still summarises it on
// request; paying for it unattended is what this must not do.
check('not due: marked N/A by hand', isDueForAutoSummary(call({ oppNa: true, oppTagManual: true })), false);
check('not due: marked N/A by a rule', isDueForAutoSummary(call({ oppNa: true, oppNaRule: 'Weekly 1:1' })), false);
// History rows carry a precomputed tag rather than the raw fields.
check('not due: N/A on a row shape', isDueForAutoSummary(call({ oppTag: 'na' })), false);
// Tagged wins over a stale flag, same as everywhere else in the app.
ok('due: opp id beats a leftover N/A flag', isDueForAutoSummary(call({ oppId: 'opp-1', oppNa: true })));

// ── Giving up ─────────────────────────────────────────────────────────────
ok('due: one failure is not enough to stop', isDueForAutoSummary(call({ autoSummaryAttempts: 1 })));
ok('due: two failures still retried', isDueForAutoSummary(call({ autoSummaryAttempts: 2 })));
check('not due: out of attempts', isDueForAutoSummary(call({ autoSummaryAttempts: AUTO_SUMMARY_MAX_ATTEMPTS })), false);
check('not due: past the limit', isDueForAutoSummary(call({ autoSummaryAttempts: 99 })), false);

check('gave up: at the limit', autoSummaryGaveUp(call({ autoSummaryAttempts: AUTO_SUMMARY_MAX_ATTEMPTS })), true);
check('gave up: not yet', autoSummaryGaveUp(call({ autoSummaryAttempts: 1 })), false);
check('gave up: never tried', autoSummaryGaveUp(call()), false);

// ── The failure patch counts, so the give-up survives a reload ────────────
{
  const p1 = autoSummaryFailurePatch(call(), 'HTTP 500');
  check('failure: first attempt counted', p1.autoSummaryAttempts, 1);
  check('failure: reason kept', p1.autoSummaryError, 'HTTP 500');
  ok('failure: stamped', !!p1.autoSummaryFailedAt);

  const p2 = autoSummaryFailurePatch(call({ autoSummaryAttempts: 2 }), 'HTTP 500');
  check('failure: counts up from the record', p2.autoSummaryAttempts, 3);
  ok('failure: that is the give-up point', autoSummaryGaveUp({ ...call(), ...p2 }));

  // A garbage counter must not read as "infinite retries left".
  check('failure: non-numeric counter starts over', autoSummaryFailurePatch(call({ autoSummaryAttempts: 'x' })).autoSummaryAttempts, 1);
  // A long API error doesn't get stored in full.
  check('failure: reason is capped', autoSummaryFailurePatch(call(), 'e'.repeat(500)).autoSummaryError.length, 300);
}

// ── The queue: newest first, capped ───────────────────────────────────────
{
  const records = {
    old: call({ id: 'old', recordedAt: '2026-01-01T00:00:00Z' }),
    mid: call({ id: 'mid', recordedAt: '2026-06-01T00:00:00Z' }),
    new: call({ id: 'new', recordedAt: '2026-09-01T00:00:00Z' }),
    done: call({ id: 'done', recordedAt: '2026-09-02T00:00:00Z', summarizedAt: 'x' }),
    na: call({ id: 'na', recordedAt: '2026-09-03T00:00:00Z', oppNa: true }),
  };
  check('queue: newest first, skips done and N/A',
    callsDueForAutoSummary(records).map(r => r.id), ['new', 'mid', 'old']);
  check('queue: honours a limit', callsDueForAutoSummary(records, { limit: 2 }).map(r => r.id), ['new', 'mid']);
  check('queue: a list works as well as a map',
    callsDueForAutoSummary(Object.values(records), { limit: 1 }).map(r => r.id), ['new']);
}

// A back-fill must not summarise a year of calls in one pass.
{
  const many = Array.from({ length: 40 }, (_, i) =>
    call({ id: `c${i}`, recordedAt: `2026-0${(i % 9) + 1}-01T00:00:00Z` }));
  check('queue: default cap', callsDueForAutoSummary(many).length, AUTO_SUMMARY_PER_RUN);
  ok('queue: the cap is small', AUTO_SUMMARY_PER_RUN <= 5);
}

// Records with no date at all still come back rather than being dropped.
{
  const undated = [call({ id: 'a', recordedAt: null }), call({ id: 'b', recordedAt: null })];
  check('queue: undated calls are still due', callsDueForAutoSummary(undated).length, 2);
}

check('queue: nothing stored', callsDueForAutoSummary(null), []);
check('queue: empty map', callsDueForAutoSummary({}), []);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
