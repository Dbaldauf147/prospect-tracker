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
  countLadderWork, ladderWork,
  todayISO, RENEWAL_ISSUE_TYPES,
} from '../src/utils/prospectingStatus.js';
import { readSteps } from '../src/utils/prospectingPlaybook.js';
import { countCallInDue } from '../src/utils/oppsCallIn.js';

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

// An uncounted step the app can still answer for — the market-updates step,
// once every campaign that isn't paused has finished sending.
eq(categorizeStep({ autoClear: true }), 'caught-up', 'the data can clear an uncounted step without a tick');
eq(categorizeStep({ autoClear: false }), 'open', 'and leaves it to be marked by hand when it cannot');
eq(categorizeStep({ autoClear: null }), 'unknown', 'evidence that has not loaded is not "all caught up"');
eq(categorizeStep({ autoClear: null, marked: true }), 'caught-up',
  'but a step the user ticked is caught up whatever is still loading');

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
const ladder = (steps, counts, map, autoClear) => ladderStates({ steps, counts, autoClear, caughtUpMap: map, today: TODAY });
const stateOf = (steps, counts, map, key, autoClear) => statesByKey(ladder(steps, counts, map, autoClear))[key]?.state;

// Built the way the page builds it, so the flags and count functions are
// the real ones rather than a hand-written stand-in. Contact mapping is
// listed explicitly: readSteps would insert it above market-updates
// anyway (it was split out of that step), and a fixture that pretends
// otherwise would be testing a ladder nobody has.
const STEPS = readSteps({ prospectingSteps: [
  { key: 'opps' }, { key: 'renewals' }, { key: 'contact-mapping' }, { key: 'market-updates' }, { key: 'cold' },
] });
const CLEAR = { opps: 0, renewals: 0 };
// Mapping sits above the campaigns and is flagged the same way, so it is
// the one that goes red first; marking it is what hands the red down.
const MAPPED = { 'contact-mapping': TODAY };

eq(stateOf(STEPS, CLEAR, {}, 'contact-mapping'), 'due',
  'with every step above it clear, the contact-mapping step is outstanding');
eq(stateOf(STEPS, CLEAR, {}, 'market-updates'), 'open',
  'the campaigns step waits its turn behind mapping rather than going red beside it');
eq(stateOf(STEPS, CLEAR, MAPPED, 'market-updates'), 'due',
  'and takes the red once mapping is marked');
eq(stateOf(STEPS, { opps: 2, renewals: 0 }, MAPPED, 'market-updates'), 'open',
  'overdue opps above it keep the step waiting its turn, not red');
eq(stateOf(STEPS, { opps: 0, renewals: 3 }, MAPPED, 'market-updates'), 'open',
  'renewals still to work keep it waiting too');
eq(stateOf(STEPS, { opps: 0, renewals: null }, MAPPED, 'market-updates'), 'open',
  'a count still loading above it is not "clear" — no red on data that has not arrived');
eq(stateOf(STEPS, {}, MAPPED, 'market-updates'), 'open',
  'no counts handed over at all leaves every tracked step unknown, so nothing goes red');
eq(stateOf(STEPS, CLEAR, { ...MAPPED, 'market-updates': TODAY }, 'market-updates'), 'caught-up',
  'marking it caught up today clears it');
eq(stateOf(STEPS, CLEAR, { ...MAPPED, 'market-updates': '2026-08-25' }, 'market-updates'), 'due',
  "yesterday's mark does not hold it down today");

// Only a step flagged in the playbook does this. Cold outreach is
// hand-marked too, but it stays grey rather than adding a second red row
// the moment the market-updates step is ticked.
eq(stateOf(STEPS, CLEAR, { ...MAPPED, 'market-updates': TODAY }, 'cold'), 'open',
  'an unflagged hand-marked step below it stays open, not outstanding');

// The dot on the sidebar counts exactly the red-because-reached rows.
eq(countDueSteps(ladder(STEPS, CLEAR, {})), 1, 'one dot while the step stands');
// Two flagged steps in a row, and still one dot: only the topmost
// unresolved one is owed, which is the point of walking the ladder.
eq(countDueSteps(ladder(STEPS, CLEAR, MAPPED)), 1,
  'still one dot with mapping marked — the campaigns step has it now');
eq(countDueSteps(ladder(STEPS, CLEAR, { ...MAPPED, 'market-updates': TODAY })), 0,
  'no dot once both are marked');
eq(countDueSteps(ladder(STEPS, { opps: 1, renewals: 0 }, {})), 0,
  'no dot while there is still warmer work above it');
eq(countDueSteps([]), 0, 'no steps at all means no dot');

// Order is the user's, so the rule follows the ladder rather than the
// shipped positions: moved to the top, the step is owed straight away.
{
  // Mapping is listed below it on purpose: left out, readSteps would put
  // it back above (the split), and this case is about the step the user
  // dragged to the top.
  const moved = readSteps({ prospectingSteps: [
    { key: 'market-updates' }, { key: 'opps' }, { key: 'renewals' }, { key: 'contact-mapping' },
  ] });
  eq(stateOf(moved, { opps: 5, renewals: 5 }, {}, 'market-updates'), 'due',
    'at the top of the ladder it is outstanding whatever sits below it');
}

// A tracked step is never talked over by this: its count still decides.
eq(stateOf(STEPS, { opps: 4 }, { opps: TODAY }, 'opps'), 'work',
  'a real count still outranks a manual mark inside the ladder walk');

// --- the campaigns answering for the market-updates step -------------------
//
// The step is the batch a saved campaign sends, so a book whose campaigns
// have all gone out has done it — asking for a tick on top of that is
// asking the user to confirm what the page is already showing them.
// campaignsAllSent works out the boolean (see campaignOutreach.test.mjs);
// here it arrives as the `autoClear` entry and has to behave like a count
// of zero, red row and sidebar dot included.
const SENT = { 'market-updates': true };
const UNSENT = { 'market-updates': false };
const LOADING = { 'market-updates': null };

eq(stateOf(STEPS, CLEAR, MAPPED, 'market-updates', SENT), 'caught-up',
  'every campaign sent clears the step with nothing marked');
eq(stateOf(STEPS, CLEAR, MAPPED, 'market-updates', UNSENT), 'due',
  'a campaign still going out leaves it outstanding');
eq(stateOf(STEPS, CLEAR, MAPPED, 'market-updates', LOADING), 'unknown',
  'campaigns still loading show nothing rather than an unearned red or green');
eq(stateOf(STEPS, CLEAR, { ...MAPPED, 'market-updates': TODAY }, 'market-updates', LOADING), 'caught-up',
  "a mark made today still clears it while they load");
eq(statesByKey(ladder(STEPS, CLEAR, MAPPED, SENT))['market-updates'].auto, true,
  'the row says it cleared itself, so the page can drop the undo it has no mark for');
eq(statesByKey(ladder(STEPS, CLEAR, { ...MAPPED, 'market-updates': TODAY }, SENT))['market-updates'].auto, undefined,
  'a step the user actually marked is not flagged as self-cleared');
eq(countDueSteps(ladder(STEPS, CLEAR, MAPPED, SENT)), 0,
  'and no Prospecting dot for work the campaigns say is done');
eq(countDueSteps(ladder(STEPS, CLEAR, MAPPED, UNSENT)), 1, 'the dot stands while one is unsent');
eq(countDueSteps(ladder(STEPS, CLEAR, MAPPED, LOADING)), 0, 'and holds while they load');
// The step below is only reached because the campaigns cleared this one.
eq(stateOf(STEPS, CLEAR, MAPPED, 'cold', SENT), 'open',
  'the ladder walks on past a self-cleared step');
// An auto-clear must never talk over a count, the same way a manual mark
// cannot: no step has both today, and the rule should not depend on that.
eq(stateOf(STEPS, { opps: 4, renewals: 0 }, {}, 'opps', { opps: true }), 'work',
  'a real count outranks an auto-clear too');

// --- the tag rosters answering for the contact-mapping step ----------------
//
// The same shape one step up. That step asks for the tag questions the Tagged
// row printed under it counts, so with Key, Client and Key Prospect all at
// 100% there is nothing left for it to ask — tagsAllMapped works the answer
// out (see rosterTagDebt.test.mjs) and it arrives here the same way the
// campaigns do. What is worth guarding here is the pair: mapping clearing
// itself has to hand the red down to the campaigns step exactly as a tick
// does, or the ladder stalls on a green row.
{
  const TAGGED = { 'contact-mapping': true };
  const UNTAGGED = { 'contact-mapping': false };
  const TAGS_LOADING = { 'contact-mapping': null };

  eq(stateOf(STEPS, CLEAR, {}, 'contact-mapping', TAGGED), 'caught-up',
    'fully mapped rosters clear the mapping step with nothing marked');
  eq(stateOf(STEPS, CLEAR, {}, 'contact-mapping', UNTAGGED), 'due',
    'a roster still short of 100% leaves it outstanding');
  eq(stateOf(STEPS, CLEAR, {}, 'contact-mapping', TAGS_LOADING), 'unknown',
    'coverage still loading shows nothing rather than an unearned red or green');
  eq(statesByKey(ladder(STEPS, CLEAR, {}, TAGGED))['contact-mapping'].auto, true,
    'the row says it cleared itself');
  eq(statesByKey(ladder(STEPS, CLEAR, MAPPED, TAGGED))['contact-mapping'].auto, undefined,
    'a mapping step the user actually marked is not flagged as self-cleared');

  // The point of the pair: the ladder has to keep walking.
  eq(stateOf(STEPS, CLEAR, {}, 'market-updates', TAGGED), 'due',
    'the campaigns step takes the red once the tags answer for the step above it');
  eq(countDueSteps(ladder(STEPS, CLEAR, {}, TAGGED)), 1,
    'so the sidebar still shows one dot, now for that step');
  eq(countDueSteps(ladder(STEPS, CLEAR, {}, { ...TAGGED, 'market-updates': true })), 0,
    'and none once both steps have answered for themselves');
  eq(countDueSteps(ladder(STEPS, CLEAR, {}, TAGS_LOADING)), 0,
    'nothing is owed while the coverage is still loading');
}

// --- the dot and the Opps badge, end to end -------------------------------
//
// The walk above was always right; what broke was the number fed into it.
// The opps step ran its own stricter count, so an opp due TODAY badged the
// Opps nav item red while this step read 0 and let market-updates go 'due'
// — a Prospecting dot over calls the user hadn't made. Feeding both from
// countCallInDue is the fix, so drive the ladder from real opp records the
// way App does and check the two readouts can't disagree.
{
  const iso = (offset) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fromRecords = (records) => ladder(STEPS, { opps: countCallInDue(records), renewals: 0 }, {});

  // The reported shape: one opp due today, nothing else outstanding.
  const dueToday = [{ Stage: 'Qualifying', 'Follow Up': iso(0) }];
  eq(countCallInDue(dueToday), 1, 'the badge shows 1 for an opp due today');
  eq(statesByKey(fromRecords(dueToday))['opps'].state, 'work',
    'so the opps step is work, not caught up');
  eq(countDueSteps(fromRecords(dueToday)), 0,
    'and no Prospecting dot while that badge is up');

  // The closed-opp case the old count also dropped.
  const closedOverdue = [{ Stage: 'Sold', 'Follow Up': iso(-5) }];
  eq(countDueSteps(fromRecords(closedOverdue)), 0,
    'a badged closed opp holds the dot back too — the two readouts agree or neither fires');

  // Clear the badge and the dot is free to fire again.
  const settled = [{ Stage: 'Qualifying', 'Follow Up': iso(0), 'No Further Action Today': 'Yes' }];
  eq(countCallInDue(settled), 0, 'marking it settles the badge');
  eq(countDueSteps(fromRecords(settled)), 1, 'and the dot comes back for the next step down');
}

// --- what the Prospecting nav badge says -----------------------------------
//
// The number is "what is owed now", not "everything outstanding": the ladder
// is walked in order and stops at the first step that isn't caught up, the
// same rule the dot follows. A count raised from three rungs down, while the
// steps above it are still outstanding, sends the user past the warmer work
// the ladder puts first — which is the whole point of ranking them.
{
  // The shipped ladder, not the trimmed fixture above: this is about the
  // counted steps further down it (services, PE intros), which that one
  // leaves out.
  const FULL = readSteps(null);
  // Everything above the services step cleared: opps and renewals counted to
  // zero, the two hand-marked steps between them marked today.
  const ABOVE_CLEAR = { 'contact-mapping': TODAY, 'market-updates': TODAY };
  const badge = (counts, map = ABOVE_CLEAR, autoClear = null) => countLadderWork(ladder(FULL, counts, map, autoClear));

  eq(badge({ ...CLEAR, 'targeted-services': 2, 'pe-intros': 0 }), 2,
    'with the steps above it clear, two services short of coverage badge a 2');
  eq(ladderWork(ladder(FULL, { ...CLEAR, 'targeted-services': 2 }, ABOVE_CLEAR))?.key, 'targeted-services',
    'and the badge names the step the number came from');
  eq(badge(CLEAR), 0, 'a clear ladder badges nothing');

  // The rule the user asked for: the previous stages have to be done first.
  eq(badge({ ...CLEAR, 'targeted-services': 2 }, {}), 0,
    'an unmarked hand-marked step above it holds the number back');
  eq(badge({ ...CLEAR, 'targeted-services': 2 }, { 'contact-mapping': TODAY }), 0,
    'and so does the next one down, still unmarked');
  eq(badge({ opps: 0, renewals: 3, 'targeted-services': 2 }), 3,
    'renewals outstanding above it show their own number instead');
  eq(badge({ opps: 0, renewals: null, 'targeted-services': 2 }), 0,
    'a count still loading above it badges nothing rather than skipping past it');

  // Auto-clearing a step counts as clearing it, like a mark does.
  eq(badge({ ...CLEAR, 'targeted-services': 2 }, {}, { 'contact-mapping': true, 'market-updates': true }), 2,
    'steps that cleared themselves let the number through');

  // The one step left out, and why.
  eq(badge({ opps: 4, renewals: 0, 'targeted-services': 2 }), 0,
    'opps due are badged on the Opps item, so nothing is shown here while they stand');

  // A hand-marked step the ladder has reached owes work too, but there is no
  // number for it — that is the dot's job, and the two are separate readouts.
  eq(badge(CLEAR, {}), 0, 'a due hand-marked step puts no number on the badge');
  eq(countDueSteps(ladder(FULL, CLEAR, {})) > 0, true, 'it raises the dot instead');

  eq(countLadderWork([]), 0, 'no steps, no badge');
  eq(countLadderWork(null), 0, 'and no states at all is not a crash');
  eq(ladderWork(null), null, 'nor is asking which step it came from');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
