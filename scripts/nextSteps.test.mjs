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
  nextStepLinesFromCall, appendNextSteps,
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
