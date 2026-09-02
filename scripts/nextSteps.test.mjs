// Assertion tests for the Next Steps field's format and for appending a
// call's follow-ups to it. Plain Node — no test framework (the project
// has none). Run:
//   node scripts/nextSteps.test.mjs
//
// Two things here can quietly corrupt an opp: losing the alignment
// between the step lines and the parallel Waiting On array (every step
// below the break starts showing somebody else's), and rewriting a list
// the user has been editing by hand. Most of what follows is about
// those two.
import {
  textToBulletItems, encodeNoteLine, NOTE_LINEBREAK,
  nextStepLinesFromCall, appendNextSteps, backfillNextStepPatches, callOnOppPatch,
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

// --- appending to an opp -------------------------------------------------
{
  const out = appendNextSteps('Call the plant\nChase the PO', ['Client', ''], ['Send pricing']);
  eq(out.added, 1, 'a new step is added');
  eq(out.text.split('\n'), ['Call the plant', 'Chase the PO', 'Send pricing'], 'at the end of the list');
  eq(out.waiting, ['Client', '', ''], 'the Waiting On array grows with it, existing entries in place');
}

{
  // The alignment case that matters: an opp whose waiting array is
  // shorter than its list (or missing entirely) must not have the new
  // blanks land against older lines.
  const out = appendNextSteps('One\nTwo\nThree', ['Client'], ['Four']);
  eq(out.waiting, ['Client', '', '', ''], 'a short waiting array is padded to the existing lines first');
  eq(out.waiting.length, textToBulletItems(out.text).length, 'one waiting entry per step, always');

  const none = appendNextSteps('One\nTwo', undefined, ['Three']);
  eq(none.waiting, ['', '', ''], 'a missing waiting array is built from scratch, aligned');
}

{
  const out = appendNextSteps('Send pricing\nBook the walk', ['', ''], ['send pricing.', 'Chase the PO']);
  eq(out.added, 1, 'a step already on the list is not added again');
  eq(out.skipped, 1, 'and is reported as skipped');
  eq(textToBulletItems(out.text), ['Send pricing', 'Book the walk', 'Chase the PO'],
    'the existing wording is kept — the user may have edited it');
}

{
  const text = 'Send pricing';
  const waiting = ['Client'];
  const out = appendNextSteps(text, waiting, ['Send pricing']);
  eq(out.added, 0, 'nothing new means nothing added');
  ok(out.text === text, 'the same string comes back, so the caller can skip the write');
  ok(out.waiting === waiting, 'and the same array');

  const empty = appendNextSteps('Send pricing', ['Client'], []);
  eq(empty.added, 0, 'no incoming steps is not an edit');
  ok(empty.waiting === waiting || JSON.stringify(empty.waiting) === JSON.stringify(waiting),
    'and leaves the waiting array alone');
}

{
  // Onto an opp with nothing in the field yet.
  const out = appendNextSteps('', [], ['Send pricing', 'Book the walk']);
  eq(out.text, 'Send pricing\nBook the walk', 'an empty field takes the steps as the whole list');
  eq(out.waiting, ['', ''], 'with a blank waiting entry each');
  eq(appendNextSteps(null, null, ['One']).text, 'One', 'a missing field is the same as an empty one');
}

{
  // A user-typed marker on an existing line must not read as a different
  // step from the same text without one.
  const out = appendNextSteps('- Send pricing', [''], ['Send pricing']);
  eq(out.added, 0, 'a marker the user typed does not make the same step look new');
  eq(out.text, '- Send pricing', 'and their line is left exactly as they wrote it');
}

{
  // Round trip: what goes in as one two-line step comes back as one step.
  const out = appendNextSteps('', [], nextStepLinesFromCall({
    followUps: [{ text: 'Send pricing\nand the term sheet' }],
  }));
  eq(textToBulletItems(out.text).length, 1, 'a multi-line follow-up lands as a single step');
  eq(out.waiting.length, 1, 'and gets exactly one waiting entry');
}

// --- the backfill onto opps mapped before any of this existed ------------
// It may only ever produce what tagging those same calls in date order
// would have. Anything it adds that the live path wouldn't is a line
// appearing in a checklist the user never agreed to.
{
  const call = (id, oppId, at, ...steps) => ({
    id, oppId, recordedAt: at, followUps: steps.map(text => ({ text })),
  });
  const records = [
    call('c2', 'opp-1', '2026-03-02T10:00:00Z', 'Send the redline'),
    call('c1', 'opp-1', '2026-01-05T10:00:00Z', 'Send pricing', 'Book the walk'),
    call('c3', 'opp-2', '2026-02-01T10:00:00Z', 'Chase the meter list'),
    call('c4', '', '2026-02-01T10:00:00Z', 'Nothing to attach this to'),
  ];
  const opps = [
    { _id: 'opp-1', 'Next Steps': 'Call Rita back', _nextStepsWaiting: ['Rita'] },
    { _id: 'opp-2' },
    { _id: 'opp-3', 'Next Steps': 'Untouched' },
  ];

  const out = backfillNextStepPatches(records, opps);
  eq(out.opps, 2, 'only the opps with mapped calls are patched');
  eq(out.steps, 4, 'every follow-up those calls carried is counted');
  eq(out.calls, 3, 'and the calls they came from');
  eq(textToBulletItems(out.patches['opp-1']['Next Steps']),
    ['Call Rita back', 'Send pricing', 'Book the walk', 'Send the redline'],
    'a call’s steps replay oldest first, under what the user already had');
  eq(out.patches['opp-1']._nextStepsWaiting, ['Rita', '', '', ''],
    'the existing Waiting On stays on its own step, and the new ones get blanks');
  eq(out.patches['opp-2']['Next Steps'], 'Chase the meter list',
    'an opp with an empty field takes the steps as the whole list');
  ok(!('opp-3' in out.patches), 'an opp with no mapped call is not touched');

  // Running it again on what it just wrote.
  const settled = [
    { _id: 'opp-1', ...out.patches['opp-1'] },
    { _id: 'opp-2', ...out.patches['opp-2'] },
  ];
  eq(backfillNextStepPatches(records, settled), { patches: {}, opps: 0, steps: 0, calls: 0 },
    'pressing it twice adds nothing the second time');
}

{
  // The same list the live path would have built, arrived at the other
  // way round: two calls tagged one after another.
  const calls = [
    { id: 'a', oppId: 'o', recordedAt: '2026-01-01T00:00:00Z', followUps: [{ text: 'One' }] },
    { id: 'b', oppId: 'o', recordedAt: '2026-01-02T00:00:00Z', followUps: [{ text: 'Two' }] },
  ];
  const live = appendNextSteps(
    appendNextSteps('', [], nextStepLinesFromCall(calls[0])).text,
    appendNextSteps('', [], nextStepLinesFromCall(calls[0])).waiting,
    nextStepLinesFromCall(calls[1]),
  );
  const back = backfillNextStepPatches(calls, [{ _id: 'o' }]).patches['o'];
  eq(back['Next Steps'], live.text, 'the backfill produces exactly what tagging in order would have');
  eq(back._nextStepsWaiting, live.waiting, 'including the waiting array');
}

{
  // A step the user already typed by hand is not added again, and a call
  // with nothing to say doesn't make an opp look like it changed.
  const records = [
    { id: 'a', oppId: 'o', followUps: [{ text: 'Send pricing.' }] },
    { id: 'b', oppId: 'o', summary: 'Talked.', followUps: [] },
  ];
  const out = backfillNextStepPatches(records, [{ _id: 'o', 'Next Steps': 'Send pricing' }]);
  eq(out, { patches: {}, opps: 0, steps: 0, calls: 0 },
    'a step already on the list, however it was punctuated, is not added twice');
}

{
  // Undated calls can't be placed in the order, so they go last rather
  // than ahead of a call that can be dated.
  const records = [
    { id: 'u', oppId: 'o', followUps: [{ text: 'Undated step' }] },
    { id: 'd', oppId: 'o', recordedAt: '2026-05-05T00:00:00Z', followUps: [{ text: 'Dated step' }] },
  ];
  eq(textToBulletItems(backfillNextStepPatches(records, [{ _id: 'o' }]).patches['o']['Next Steps']),
    ['Dated step', 'Undated step'], 'the dated call is replayed first');
}

{
  eq(backfillNextStepPatches([], []), { patches: {}, opps: 0, steps: 0, calls: 0 },
    'nothing in, nothing out');
  eq(backfillNextStepPatches(null, null).opps, 0, 'missing inputs are not a crash');
  eq(backfillNextStepPatches({ x: { id: 'a', oppId: 'o', followUps: [{ text: 'Step' }] } },
    [{ _id: 'o' }]).steps, 1, 'the id-keyed record map is accepted as well as an array');
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
  const { patch, added } = callOnOppPatch({ _id: 'o', 'Next Steps': 'Call the plant', _nextStepsWaiting: ['Client'] }, call);
  eq(added, 2, 'both follow-ups land as next steps');
  eq(textToBulletItems(patch['Next Steps']), ['Call the plant', 'Send pricing', 'Book the walk'],
    'appended under what the opp already had');
  eq(patch['_nextStepsWaiting'], ['Client', '', ''], 'the Waiting On array stays index-aligned');
  eq(patch['_lastCallId'], 'c1', 'and the opp learns which call it was');
  eq(patch['_lastCallName'], 'Acme kickoff', 'by name');
  ok(patch['_lastCallGist'].startsWith('Talked pricing'), 'with the gist of what was said');
}

{
  // A call mapped before it was summarised has nothing to say about what
  // to do next, but it is still the deal's last conversation.
  const { patch, added } = callOnOppPatch({ _id: 'o' }, { id: 'c2', name: 'Intro', recordedAt: '2026-05-05T00:00:00Z' });
  eq(added, 0, 'a call with no follow-ups adds no steps');
  eq(patch['Next Steps'], undefined, 'and does not touch the checklist');
  eq(patch['_lastCallId'], 'c2', 'but still stamps the reference');
}

{
  // Re-tagging the same call must not re-append what it already gave —
  // the checklist is a list the user edits, and a duplicate line is the
  // failure this whole path is built to avoid. The reference is rewritten
  // (the same call always wins against itself, so a re-summarise can
  // refresh the gist), but it rewrites the same values.
  const call = { id: 'c3', name: 'Acme', recordedAt: '2026-05-05T00:00:00Z', followUps: [{ text: 'Send pricing' }] };
  const first = callOnOppPatch({ _id: 'o' }, call);
  const opp = { _id: 'o', ...first.patch };
  const second = callOnOppPatch(opp, call);
  eq(second.added, 0, 'the second tag adds no steps');
  eq(second.patch['Next Steps'], undefined, 'and leaves the checklist alone');
  eq(second.patch['_lastCallId'], 'c3', 'the reference is refreshed onto the same call');
}

{
  // The newest CALL wins, not the newest write: tagging an old call today
  // must not make it the deal's most recent conversation.
  const opp = { _id: 'o', _lastCallId: 'new', _lastCallAt: '2026-06-01T00:00:00Z' };
  const { patch, added } = callOnOppPatch(opp, {
    id: 'old', name: 'January call', recordedAt: '2026-01-01T00:00:00Z',
    followUps: [{ text: 'Send pricing' }],
  });
  eq(added, 1, 'an older call still contributes its steps');
  eq(patch['_lastCallId'], undefined, 'but does not displace a newer call as the last conversation');
}

{
  eq(callOnOppPatch(null, null), { patch: {}, added: 0 }, 'missing inputs are not a crash');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
