// Assertion tests for the per-opp call log behind the Opp details "Call
// Notes" subtab. Plain Node — no test framework (the project has none).
// Run:
//   node scripts/callNextStepsLog.test.mjs
//
// The log is a HISTORY, and the two ways a history lies are dropping
// entries and reordering them. Most of what follows is about those: every
// mapped call appears whether or not it produced anything, calls from
// other deals never do, and the order is the order the conversations
// happened in.
import { callNextStepsLog, callNextStepsSummary } from '../src/utils/callNextStepsLog.js';
import { NOTE_LINEBREAK } from '../src/utils/nextSteps.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

const call = (over) => ({ id: 'c', oppId: '7', recordedAt: '2026-05-05T00:00:00Z', ...over });

// --- which calls are in the log ------------------------------------------
{
  const records = [
    call({ id: 'a', followUps: [{ text: 'Send pricing' }] }),
    call({ id: 'b', oppId: '8', followUps: [{ text: 'Somebody else’s step' }] }),
    call({ id: 'c', oppId: '', followUps: [{ text: 'Untagged step' }] }),
  ];
  eq(callNextStepsLog(records, '7').map(e => e.id), ['a'], 'only calls mapped to this opp');
  eq(callNextStepsLog(records, 7).map(e => e.id), ['a'], 'the opp id may arrive as a number');
  eq(callNextStepsLog(records, ''), [], 'no opp, no log');
  eq(callNextStepsLog(records, null), [], 'a missing opp is not a crash');
  eq(callNextStepsLog(null, '7'), [], 'missing records are not a crash');
  eq(callNextStepsLog({ x: call({ id: 'a' }) }, '7').length, 1,
    'the id-keyed record map is accepted as well as an array');
}

{
  // A mapped call that produced nothing is still an entry. Dropping it
  // would make an un-summarised call look like a week nobody called.
  const records = [
    call({ id: 'quiet' }),
    call({ id: 'summarised', summary: 'We spoke.', summarizedAt: '2026-05-06T00:00:00Z' }),
  ];
  const log = callNextStepsLog(records, '7');
  eq(log.map(e => e.id).sort(), ['quiet', 'summarised'], 'a call with no follow-ups is still logged');
  eq(log.find(e => e.id === 'quiet').summarized, false, 'and says it has never been summarized');
  eq(log.find(e => e.id === 'summarised').summarized, true,
    'while one that was says so, so an empty list reads as an answer');
  eq(callNextStepsLog([call({ id: 'g', granolaSummary: 'Written up in Granola.' })], '7')[0].summarized,
    true, 'a Granola write-up counts as summarized too');
}

// --- the order ------------------------------------------------------------
{
  const records = [
    call({ id: 'mar', recordedAt: '2026-03-01T00:00:00Z' }),
    call({ id: 'may', recordedAt: '2026-05-01T00:00:00Z' }),
    call({ id: 'apr', recordedAt: '2026-04-01T00:00:00Z' }),
  ];
  eq(callNextStepsLog(records, '7').map(e => e.id), ['may', 'apr', 'mar'], 'newest call first');
}

{
  // An undated call can't be shown to be the most recent thing that
  // happened, so it doesn't get to claim the top of the log.
  const records = [
    call({ id: 'undated', recordedAt: '' }),
    call({ id: 'dated', recordedAt: '2026-05-01T00:00:00Z' }),
  ];
  eq(callNextStepsLog(records, '7').map(e => e.id), ['dated', 'undated'], 'undated calls sort last');
  eq(callNextStepsLog([
    call({ id: 'one', recordedAt: '' }), call({ id: 'two', recordedAt: '' }),
  ], '7').map(e => e.id), ['one', 'two'], 'and keep their relative order rather than shuffling');
}

{
  // A call listed straight from a folder has no recordedAt yet, but the
  // record still knows when it was first stored.
  eq(callNextStepsLog([call({ id: 'x', recordedAt: '', createdAt: '2026-02-02T00:00:00Z' })], '7')[0].at,
    '2026-02-02T00:00:00Z', 'createdAt stands in for a missing recordedAt');
}

// --- what each entry carries ---------------------------------------------
{
  const log = callNextStepsLog([call({
    id: 'a',
    name: 'Acme pricing review',
    granolaUrl: 'https://granola.example/a',
    nextStepsPushed: 2,
    followUps: [{ text: 'Send the quote', owner: 'Dan', due: 'Friday' }, { text: 'Book the walk' }],
  })], '7');
  eq(log[0].steps, ['Send the quote — Dan (due Friday)', 'Book the walk'],
    'the steps read exactly as the ones pushed onto the checklist');
  eq(log[0].name, 'Acme pricing review', 'the call names itself');
  eq(log[0].url, 'https://granola.example/a', 'and links back to where it came from');
  eq(log[0].pushed, 2, 'and says how many of its steps reached the checklist');
  ok(log[0].atMs > 0, 'the date is usable for sorting as well as display');
  eq(callNextStepsLog([call({ id: 'a' })], '7')[0].name, 'Untitled call',
    'a call with no name still reads as something');
}

{
  // The same commitment made on three calls is the most interesting thing
  // a log like this can show. Collapsing it would hide exactly that.
  const records = [
    call({ id: 'one', recordedAt: '2026-03-01T00:00:00Z', followUps: [{ text: 'Send pricing' }] }),
    call({ id: 'two', recordedAt: '2026-04-01T00:00:00Z', followUps: [{ text: 'Send pricing' }] }),
  ];
  const log = callNextStepsLog(records, '7');
  eq(log.map(e => e.steps), [['Send pricing'], ['Send pricing']],
    'a step repeated across calls is logged under each of them');
}

{
  // A multi-line follow-up is one step, carried as U+2028 so it survives
  // the storage format. The view puts the break back.
  const log = callNextStepsLog([call({ id: 'a', followUps: [{ text: 'Do this\nthen that' }] })], '7');
  eq(log[0].steps, [`Do this${NOTE_LINEBREAK}then that`], 'a two-line follow-up stays one step');
}

// --- the header line ------------------------------------------------------
{
  const entries = callNextStepsLog([
    call({ id: 'a', recordedAt: '2026-05-01T00:00:00Z', summarizedAt: 'x', followUps: [{ text: 'One' }, { text: 'Two' }] }),
    call({ id: 'b', recordedAt: '2026-04-01T00:00:00Z', summarizedAt: 'x', followUps: [{ text: 'Three' }] }),
    call({ id: 'c', recordedAt: '2026-03-01T00:00:00Z' }),
  ], '7');
  eq(callNextStepsSummary(entries), { calls: 3, steps: 3, unsummarized: 1 },
    'the header counts the calls, the steps, and what still needs summarizing');
  eq(callNextStepsSummary([]), { calls: 0, steps: 0, unsummarized: 0 }, 'an empty log adds up to nothing');
  eq(callNextStepsSummary(null), { calls: 0, steps: 0, unsummarized: 0 }, 'missing input is not a crash');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
