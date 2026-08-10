// Assertion tests for the Prospecting page's Status column. Plain Node —
// no test framework (the project has none). Run:
//   node scripts/prospectingStatus.test.mjs
//
// The two failure modes worth guarding are both silent, and both say
// "you're done" when the user isn't:
//
//   - a step categorized as caught up because its count hasn't loaded
//     yet (null must not read as zero);
//   - a manual mark from an earlier day still counting today.
//
// The store helpers touch localStorage, which doesn't exist here; userLs
// swallows that, so only the pure functions are exercised below.
import {
  categorizeStep, countRenewalWork, countServiceGaps, isMarkedCaughtUp, parseCaughtUpMap,
  readCaughtUpSnapshot, todayISO, RENEWAL_ISSUE_TYPES,
} from '../src/utils/prospectingStatus.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ---- categorizing one step --------------------------------------------------

eq(categorizeStep({ count: 0 }), 'caught-up', 'a counted step with nothing outstanding is caught up');
eq(categorizeStep({ count: 3 }), 'work', 'a counted step with items outstanding is work');
eq(categorizeStep({ count: null }), 'unknown', 'a count still loading is unknown, not caught up');
eq(categorizeStep({ count: undefined, marked: false }), 'open', 'an uncounted step starts the day open');
eq(categorizeStep({ count: undefined, marked: true }), 'caught-up', 'an uncounted step marked today is caught up');
eq(categorizeStep(), 'open', 'no argument at all reads as an unmarked, uncounted step');
// A marked-today flag must not talk over a real count: the data wins.
eq(categorizeStep({ count: 2, marked: true }), 'work', 'a real count outranks a manual mark');

// ---- manual marks expire overnight -----------------------------------------

eq(isMarkedCaughtUp({ cold: '2026-08-10' }, 'cold', '2026-08-10'), true, 'a mark made today counts');
eq(isMarkedCaughtUp({ cold: '2026-08-09' }, 'cold', '2026-08-10'), false, "yesterday's mark does not count today");
eq(isMarkedCaughtUp({}, 'cold', '2026-08-10'), false, 'an unmarked step is not caught up');
eq(isMarkedCaughtUp(null, 'cold', '2026-08-10'), false, 'a missing map is not caught up');

// ---- renewal work, from the Issues tab's rows -------------------------------

const ISSUES = [
  { type: 'Contract expired', snoozed: false },
  { type: 'Renewal: no status', snoozed: false },
  { type: 'Renewal: no status', snoozed: true },   // user said "not now"
  { type: 'No expiration date', snoozed: false },  // data hygiene, not outreach
  { type: 'HQ Region missing', snoozed: false },
];
eq(countRenewalWork(ISSUES), 2, 'only open renewal issues count');
eq(countRenewalWork([]), 0, 'no issues at all means the step is clear');
eq(countRenewalWork(null), null, 'issues not loaded yet stay unknown');
eq(countRenewalWork(undefined), null, 'a missing issues prop stays unknown');
eq(RENEWAL_ISSUE_TYPES.every(t => countRenewalWork([{ type: t }]) === 1), true,
  'every listed renewal type is counted');

// ---- targeted services, from the coverage rows ------------------------------
// One count per service under 100%, matching the Pipeline table's rows —
// not per client left to call, which would be a much bigger number for the
// same amount of work.

eq(countServiceGaps([{ id: 'a', notExplored: ['X', 'Y'] }, { id: 'b', notExplored: ['Z'] }]), 2,
  'each service below 100% counts once, however many clients are behind it');
eq(countServiceGaps([]), 0, 'every service at full coverage means the step is clear');
eq(countServiceGaps(null), null, 'coverage rows not loaded yet stay unknown');
eq(countServiceGaps(undefined), null, 'a missing serviceGaps prop stays unknown');
// The guard that matters: unknown must not categorize as caught up.
eq(categorizeStep({ count: countServiceGaps(null) }), 'unknown',
  'the targeted-services step shows nothing until its rows arrive');
eq(categorizeStep({ count: countServiceGaps([]) }), 'caught-up',
  'no gaps left categorizes the step as caught up');

// ---- reading the stored marks ----------------------------------------------

eq(parseCaughtUpMap('{"cold":"2026-08-10"}'), { cold: '2026-08-10' }, 'a stored map parses');
eq(parseCaughtUpMap(''), {}, 'nothing stored yet reads as no marks');
eq(parseCaughtUpMap('not json'), {}, 'a corrupt payload reads as no marks rather than throwing');
eq(parseCaughtUpMap('["cold"]'), {}, 'an array payload is rejected');

// The snapshot folds today's date in front of the stored JSON so the page
// re-renders when the day turns over, not just when a mark changes.
eq(readCaughtUpSnapshot('2026-08-10|{"cold":"2026-08-10"}'),
  { today: '2026-08-10', map: { cold: '2026-08-10' } }, 'a snapshot splits into date and marks');
eq(readCaughtUpSnapshot('2026-08-10|'), { today: '2026-08-10', map: {} }, 'a snapshot with no marks yet');
eq(readCaughtUpSnapshot(''), { today: '', map: {} }, 'an empty snapshot marks nothing');
// End to end: a step marked yesterday reads as open once the date moves on.
{
  const { today: t, map } = readCaughtUpSnapshot('2026-08-11|{"cold":"2026-08-10"}');
  eq(categorizeStep({ marked: isMarkedCaughtUp(map, 'cold', t) }), 'open',
    "a step marked yesterday is open again on today's snapshot");
}

// ---- the date stamp is local, not UTC ---------------------------------------

eq(todayISO(new Date(2026, 0, 5)), '2026-01-05', 'single-digit month and day are padded');
// 11pm local on the 31st is still the 31st — a UTC stamp would roll over
// early for anyone east of Greenwich and clear their marks a day late.
eq(todayISO(new Date(2026, 11, 31, 23, 30)), '2026-12-31', 'late-evening local time keeps the local date');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
