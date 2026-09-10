// Assertion tests for the Next Steps field's format and for what a
// mapped call puts on its opp. Plain Node — no test framework (the
// project has none). Run:
//   node scripts/nextSteps.test.mjs
//
// The rule this file now exists to hold: a call's follow-ups do NOT
// reach the opp's Next Steps. That checklist is what the Opps table
// shows as "Notes" and holds what the user put on it; a call's
// follow-ups stay on the call record and are read back per call by the
// Follow Up Notes popup's Calls tab (callNextStepsLog.js). Everything
// that used to append them — appendNextSteps, backfillNextStepPatches,
// and the step half of callOnOppPatch — is gone, and the assertions
// below are what would notice it coming back.
import {
  textToBulletItems, encodeNoteLine, NOTE_LINEBREAK,
  nextStepLinesFromCall, callOnOppPatch,
} from '../src/utils/nextSteps.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

// --- the storage format (moved here from Opps 2, unchanged) --------------
{
  eq(textToBulletItems('one\ntwo\nthree'), ['one', 'two', 'three'], 'lines are steps');
  eq(textToBulletItems('- one\n* two\n• three\n1. four\n2) five'),
    ['one', 'two', 'three', 'four', 'five'],
    'a marker the user typed is stripped, whichever one they used');
  eq(textToBulletItems('one\n\n\ntwo'), ['one', 'two'], 'blank lines are not steps');
  eq(textToBulletItems(''), [], 'an empty cell has no steps');
  eq(textToBulletItems(null), [], 'a missing cell has no steps');
  eq(textToBulletItems(`a${NOTE_LINEBREAK}b`), ['a\nb'], 'a break inside one step reads back as a newline');
  eq(encodeNoteLine('a\nb'), `a${NOTE_LINEBREAK}b`, 'and is stored as U+2028 so the step stays one step');
  eq(textToBulletItems(encodeNoteLine('a\nb')).length, 1, 'a two-line step survives the round trip as one step');
}

// --- a call's follow-ups as lines ----------------------------------------
{
  const lines = nextStepLinesFromCall({
    followUps: [
      { text: 'Send the pricing sheet', owner: 'Dan', due: 'Friday' },
      { text: 'Get the interval data', owner: null, due: null },
      { text: 'Loop in legal', owner: 'Dana Reid', due: null },
      { text: '', owner: 'nobody', due: null },
    ],
  });
  eq(lines, [
    'Send the pricing sheet — Dan (due Friday)',
    'Get the interval data',
    'Loop in legal — Dana Reid',
  ], 'owner and due ride in the line; an empty follow-up is not a step');
}

{
  const record = { followUps: [], nextSteps: '• Rework the quote\n• Book the site walk' };
  eq(nextStepLinesFromCall(record), ['Rework the quote', 'Book the site walk'],
    'a prose next-steps paragraph is used when there is no structured list');

  eq(nextStepLinesFromCall({
    followUps: [{ text: 'Send pricing' }],
    nextSteps: 'Something else entirely',
  }), ['Send pricing'], 'the structured list wins when both are present');

  eq(nextStepLinesFromCall({}), [], 'a call with no summary contributes nothing');
  eq(nextStepLinesFromCall(null), [], 'no record at all contributes nothing');
}

{
  const dupes = nextStepLinesFromCall({
    followUps: [{ text: 'Send pricing' }, { text: 'send  pricing.' }, { text: 'Send pricing' }],
  });
  eq(dupes, ['Send pricing'], 'a follow-up list that repeats itself arrives once');

  const many = nextStepLinesFromCall({
    followUps: Array.from({ length: 40 }, (_, i) => ({ text: `Step ${i}` })),
  });
  eq(many.length, 15, 'a malformed record cannot push a hundred steps onto an opp');
}

// --- the whole patch a mapped call puts on its opp -----------------------
//
// Both places a call can be mapped — the Call Recordings page and the
// "Calls to map" queue on Opps — go through this, so what tagging a call
// does must not depend on which page it was tagged from.
{
  const call = {
    id: 'c1',
    name: 'Acme kickoff',
    recordedAt: '2026-05-05T00:00:00Z',
    summary: 'Talked pricing.\n\nThen other things.',
    followUps: [{ text: 'Send pricing' }, { text: 'Book the walk' }],
  };
  const opp = { _id: 'o', 'Next Steps': 'Call the plant', _nextStepsWaiting: ['Client'] };
  const { patch, added } = callOnOppPatch(opp, call);
  // The point of the whole change: a call with plenty to say leaves the
  // checklist exactly as the user left it.
  eq(added, 0, 'a call adds no steps to the checklist');
  eq(patch['Next Steps'], undefined, 'the checklist is not written at all');
  eq(patch['_nextStepsWaiting'], undefined, 'nor its Waiting On array');
  eq(opp['Next Steps'], 'Call the plant', 'and the opp handed in is not mutated');
  // What it does do: name the deal's last conversation.
  eq(patch['_lastCallId'], 'c1', 'the opp learns which call it was');
  eq(patch['_lastCallName'], 'Acme kickoff', 'by name');
  ok(patch['_lastCallGist'].startsWith('Talked pricing'), 'with the gist of what was said');
}

{
  // An un-summarised call has no follow-ups either way — it is still the
  // deal's last conversation, and that half is unchanged.
  const { patch, added } = callOnOppPatch({ _id: 'o' }, { id: 'c2', name: 'Intro', recordedAt: '2026-05-05T00:00:00Z' });
  eq(added, 0, 'a call with no follow-ups adds no steps');
  eq(patch['Next Steps'], undefined, 'and does not touch the checklist');
  eq(patch['_lastCallId'], 'c2', 'but still stamps the reference');
}

{
  // Re-tagging rewrites the same reference (a re-summarise can refresh
  // the gist) and still never reaches the checklist.
  const call = { id: 'c3', name: 'Acme', recordedAt: '2026-05-05T00:00:00Z', followUps: [{ text: 'Send pricing' }] };
  const first = callOnOppPatch({ _id: 'o' }, call);
  const second = callOnOppPatch({ _id: 'o', ...first.patch }, call);
  eq(second.added, 0, 'the second tag adds no steps');
  eq(second.patch['Next Steps'], undefined, 'and leaves the checklist alone');
  eq(second.patch['_lastCallId'], 'c3', 'the reference is refreshed onto the same call');
}

{
  // The newest CALL wins, not the newest write: tagging an old call today
  // must not make it the deal's most recent conversation. With nothing
  // else in the patch, that leaves nothing to write at all — which is
  // what lets the caller skip the save entirely.
  const opp = { _id: 'o', _lastCallId: 'new', _lastCallAt: '2026-06-01T00:00:00Z' };
  const { patch } = callOnOppPatch(opp, {
    id: 'old', name: 'January call', recordedAt: '2026-01-01T00:00:00Z',
    followUps: [{ text: 'Send pricing' }],
  });
  eq(patch['_lastCallId'], undefined, 'an older call does not displace a newer one');
  eq(Object.keys(patch).length, 0, 'and leaves an empty patch, so no write happens');
}

{
  eq(callOnOppPatch(null, null), { patch: {}, added: 0 }, 'missing inputs are not a crash');
}

// The follow-ups themselves are still read off the call — they are what
// the Calls tab lists. Only their copy onto the opp is gone.
{
  const lines = nextStepLinesFromCall({
    followUps: [{ text: 'Send pricing' }, { text: 'Book the walk' }],
  });
  eq(lines, ['Send pricing', 'Book the walk'], 'a call still yields its follow-up lines');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
