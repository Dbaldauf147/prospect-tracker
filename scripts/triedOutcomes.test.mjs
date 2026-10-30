// Assertion tests for the Pipeline page's What I Tried / What Went Well /
// What Didn't Go Well boxes: the stored-record cleanup and the text the
// Excel exports draw from them.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/triedOutcomes.test.mjs
import { sanitizeTriedItems, triedOutcomeNotes, newTriedItem } from '../src/utils/triedOutcomes.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; } else { failed += 1; console.error(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── stored record cleanup ────────────────────────────────────────────────
eq(sanitizeTriedItems(undefined), [], 'missing list reads as empty');
eq(sanitizeTriedItems({ a: 1 }), [], 'a non-array reads as empty');
eq(
  sanitizeTriedItems([null, { id: 'a', text: 'x', well: 'yes' }, { id: 'a', text: 'dup' }, { text: 'no id' }, { id: 'b', text: 5, notWell: true }]),
  [{ id: 'a', text: 'x', well: false, notWell: false, wellNote: '', notWellNote: '' }, { id: 'b', text: '', well: false, notWell: true, wellNote: '', notWellNote: '' }],
  'drops junk and duplicate ids, coerces fields',
);
{
  const a = newTriedItem('one'), b = newTriedItem('two');
  eq(a.id !== b.id, true, 'new items get distinct ids');
  eq([a.text, a.well, a.notWell, a.wellNote, a.notWellNote], ['one', false, false, '', ''], 'new items start untagged, with no notes');
  eq(sanitizeTriedItems([{ id: 'z', text: 'y', wellNote: 'good', notWellNote: 7 }])[0].wellNote, 'good', 'a per-bucket note survives');
}

// ── export text ──────────────────────────────────────────────────────────
{
  const state = {
    triedItems: [
      { id: 'a', text: 'PE dinner with Cristy ', well: true, notWell: false },
      { id: 'b', text: 'Cold email blast', well: false, notWell: true },
      { id: 'c', text: 'Event prospecting', well: true, notWell: true, wellNote: 'Met 3 VPs', notWellNote: '• Expensive\n• Long travel\n• ' },
      { id: 'f', text: 'Untagged with a note', well: false, notWell: false, wellNote: 'kept for later' },
      { id: 'd', text: '   ', well: true, notWell: false },
      { id: 'e', text: 'LinkedIn posts', well: false, notWell: false },
    ],
    wentWellNotes: '• Warm intros convert\n• ',
    notWellNotes: 'Too broad a list\n\n',
  };
  const [tried, well, notWell] = triedOutcomeNotes(state, { tried: 'Tried (renamed)' });
  eq(tried.title, 'Tried (renamed)', 'renamed titles carry into the export');
  eq(tried.text.split('\n'), [
    '• PE dinner with Cristy  [Went well]',
    "• Cold email blast  [Didn't go well]",
    "• Event prospecting  [Went well, Didn't go well]",
    '• Untagged with a note',
    '• LinkedIn posts',
  ], 'every non-empty tried bullet, with its tags');
  eq(well.title, 'What Went Well', 'default bucket title');
  eq(well.text.split('\n'), ['• Tried: PE dinner with Cristy', '• Tried: Event prospecting - Met 3 VPs', '• Warm intros convert'],
    'linked tried items then the bucket notes, empty bullets dropped');
  eq(notWell.text.split('\n'), ['• Tried: Cold email blast', '• Tried: Event prospecting - Expensive; Long travel', '• Too broad a list'],
    'each tagged item carries its own note; a bucket note typed without a glyph still exports as a bullet');
}
{
  const out = triedOutcomeNotes({});
  eq(out.map(n => [n.title, n.text]), [['What I Tried', ''], ['What Went Well', ''], ["What Didn't Go Well", '']],
    'empty state still exports the three titles');
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
