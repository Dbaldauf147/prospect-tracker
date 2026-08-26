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
  categorizeStep, countDueSteps, countRenewalWork, countServiceGaps, isMarkedCaughtUp,
  isRenewalWork, ladderStates, parseCaughtUpMap, readCaughtUpSnapshot, statesByKey,
  todayISO, RENEWAL_ISSUE_TYPES,
} from '../src/utils/prospectingStatus.js';
import { readSteps } from '../src/utils/prospectingPlaybook.js';

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
// Step 3 counts the Clients tab's red rows: expiring inside the window with
// a blank Status. An expired contract someone has already put a Status on is
// still an Issues-tab row, but it is not renewal work.

eq(isRenewalWork({ type: 'Renewal: no status' }), true,
  'a renewal inside the window with no Status is work by definition');
eq(isRenewalWork({ type: 'Contract expired', noStatus: true }), true,
  'an expired contract with a blank Status is work');
eq(isRenewalWork({ type: 'Contract expired', noStatus: false }), false,
  'an expired contract someone has set a Status on is not work');
eq(isRenewalWork({ type: 'Contract expired' }), false,
  'an expired row with no flag at all is not assumed to be work');
eq(isRenewalWork({ type: 'No expiration date', noStatus: true }), false,
  'a blank Status on some other issue type is not renewal work');
eq(isRenewalWork(null), false, 'a missing row is not work');

const ISSUES = [
  { type: 'Contract expired', noStatus: true, snoozed: false },
  { type: 'Contract expired', noStatus: false, snoozed: false }, // already being worked
  { type: 'Renewal: no status', snoozed: false },
  { type: 'Renewal: no status', snoozed: true },   // user said "not now"
  { type: 'No expiration date', snoozed: false },  // data hygiene, not outreach
  { type: 'HQ Region missing', snoozed: false },
];
eq(countRenewalWork(ISSUES), 2, 'only open, status-blank renewal issues count');
eq(countRenewalWork([]), 0, 'no issues at all means the step is clear');
eq(countRenewalWork(null), null, 'issues not loaded yet stay unknown');
eq(countRenewalWork(undefined), null, 'a missing issues prop stays unknown');
eq(RENEWAL_ISSUE_TYPES.every(t => countRenewalWork([{ type: t, noStatus: true }]) === 1), true,
  'every listed renewal type counts when the Status is blank');

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

// ---- the ladder as a whole --------------------------------------------------
//
// The market-updates step has no count, so the only thing that can say it
// was worked is the user. Until the steps above it are clear it waits its
// turn in grey; once they are, it is the work owed today and says so.
// Both halves are worth guarding: a step that never goes red is the
// feature not working, and one that goes red while there is still warmer
// work above it sends the user down the ladder too early.

const TODAY = '2026-08-26';
const ladder = (steps, counts, map) => ladderStates({ steps, counts, caughtUpMap: map, today: TODAY });
const stateOf = (steps, counts, map, key) => statesByKey(ladder(steps, counts, map))[key]?.state;

// Built the way the page builds it, so the flags and count functions are
// the real ones rather than a hand-written stand-in.
const STEPS = readSteps({ prospectingSteps: [
  { key: 'opps' }, { key: 'renewals' }, { key: 'market-updates' }, { key: 'cold' },
] });
const CLEAR = { opps: 0, renewals: 0 };

eq(stateOf(STEPS, CLEAR, {}, 'market-updates'), 'due',
  'with every step above it clear, the market-updates step is outstanding');
eq(stateOf(STEPS, { opps: 2, renewals: 0 }, {}, 'market-updates'), 'open',
  'overdue opps above it keep the step waiting its turn, not red');
eq(stateOf(STEPS, { opps: 0, renewals: 3 }, {}, 'market-updates'), 'open',
  'renewals still to work keep it waiting too');
eq(stateOf(STEPS, { opps: 0, renewals: null }, {}, 'market-updates'), 'open',
  'a count still loading above it is not "clear" — no red on data that has not arrived');
eq(stateOf(STEPS, {}, {}, 'market-updates'), 'open',
  'no counts handed over at all leaves every tracked step unknown, so nothing goes red');
eq(stateOf(STEPS, CLEAR, { 'market-updates': TODAY }, 'market-updates'), 'caught-up',
  'marking it caught up today clears it');
eq(stateOf(STEPS, CLEAR, { 'market-updates': '2026-08-25' }, 'market-updates'), 'due',
  "yesterday's mark does not hold it down today");

// Only a step flagged in the playbook does this. Cold outreach is
// hand-marked too, but it stays grey rather than adding a second red row
// the moment the market-updates step is ticked.
eq(stateOf(STEPS, CLEAR, { 'market-updates': TODAY }, 'cold'), 'open',
  'an unflagged hand-marked step below it stays open, not outstanding');

// The dot on the sidebar counts exactly the red-because-reached rows.
eq(countDueSteps(ladder(STEPS, CLEAR, {})), 1, 'one dot while the step stands');
eq(countDueSteps(ladder(STEPS, CLEAR, { 'market-updates': TODAY })), 0, 'no dot once it is marked');
eq(countDueSteps(ladder(STEPS, { opps: 1, renewals: 0 }, {})), 0,
  'no dot while there is still warmer work above it');
eq(countDueSteps([]), 0, 'no steps at all means no dot');

// Order is the user's, so the rule follows the ladder rather than the
// shipped positions: moved to the top, the step is owed straight away.
{
  const moved = readSteps({ prospectingSteps: [
    { key: 'market-updates' }, { key: 'opps' }, { key: 'renewals' },
  ] });
  eq(stateOf(moved, { opps: 5, renewals: 5 }, {}, 'market-updates'), 'due',
    'at the top of the ladder it is outstanding whatever sits below it');
}

// A tracked step is never talked over by this: its count still decides.
eq(stateOf(STEPS, { opps: 4 }, { opps: TODAY }, 'opps'), 'work',
  'a real count still outranks a manual mark inside the ladder walk');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
