// Assertion tests for the Follow Up notes table's Copy button. Plain Node -
// no test framework (the project has none). Run:
//   node scripts/nextStepsCopy.test.mjs
//
// What this pins is a paste landing in somebody's spreadsheet, so the
// things worth holding are the ones that would be noticed there: the
// columns line up with the popup's, a note with line breaks in it stays
// ONE cell instead of shunting every column below it out by a row, and an
// empty table copies nothing rather than a bare header.
import {
  nextStepsCopyRows, nextStepsCopyText, nextStepsCopyHtml,
} from '../src/utils/nextStepsCopy.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }

const TODAY = '2026-09-16';

const rows = [
  { note: 'Get a copy of the proposal.', waitingOn: 'Arlene Smith/Tirtho', doneOn: TODAY },
  { note: 'Call QMC.', waitingOn: 'Brian Aitken', doneOn: '2026-09-10' },
  { note: '', waitingOn: '', doneOn: '' },
];

// ---- which rows are content -------------------------------------------------

eq(
  nextStepsCopyRows(rows, TODAY),
  [
    { note: 'Get a copy of the proposal.', waitingOn: 'Arlene Smith/Tirtho', done: 'Yes' },
    { note: 'Call QMC.', waitingOn: 'Brian Aitken', done: '' },
  ],
  'the editor’s empty row is not content, and only today’s tick counts as done',
);

eq(
  nextStepsCopyRows([{ note: '  spaced  ', waitingOn: '', doneOn: '' }], TODAY),
  [{ note: 'spaced', waitingOn: '', done: '' }],
  'a row with only a note is content, trimmed',
);

eq(
  nextStepsCopyRows([{ note: '', waitingOn: 'Ben', doneOn: '' }], TODAY),
  [{ note: '', waitingOn: 'Ben', done: '' }],
  'a row with only a Waiting On is content too',
);

// ---- the tab-separated flavour ----------------------------------------------

eq(
  nextStepsCopyText(rows, TODAY),
  'Note\tWaiting On\tDone today\n'
  + 'Get a copy of the proposal.\tArlene Smith/Tirtho\tYes\n'
  + 'Call QMC.\tBrian Aitken\t',
  'a header row, then one tab-separated row a step',
);

eq(
  nextStepsCopyText([{ note: 'How was QMC involved?\nHow much were their services?', waitingOn: 'Tirtho', doneOn: '' }], TODAY),
  'Note\tWaiting On\tDone today\n'
  + '"How was QMC involved?\nHow much were their services?"\tTirtho\t',
  'a multi-line note is quoted, so a spreadsheet reads it back as one cell',
);

eq(
  nextStepsCopyText([{ note: 'He said "no" for now', waitingOn: '', doneOn: '' }], TODAY),
  'Note\tWaiting On\tDone today\n"He said ""no"" for now"\t\t',
  'a quote in a note is doubled, the way a spreadsheet expects',
);

eq(
  nextStepsCopyText([{ note: 'Two\tcolumns?', waitingOn: '', doneOn: '' }], TODAY),
  'Note\tWaiting On\tDone today\n"Two\tcolumns?"\t\t',
  'a tab typed into a note does not become a column break',
);

eq(
  nextStepsCopyText([{ note: 'Line one\r\nLine two', waitingOn: '', doneOn: '' }], TODAY),
  'Note\tWaiting On\tDone today\n"Line one\nLine two"\t\t',
  'Windows line endings are normalised, so the cell does not gain a blank line',
);

// ---- nothing to copy --------------------------------------------------------

eq(nextStepsCopyText([], TODAY), '', 'an empty table copies nothing, not a bare header');
eq(nextStepsCopyText([{ note: '', waitingOn: '', doneOn: '' }], TODAY), '', 'a table of empty rows copies nothing');
eq(nextStepsCopyText(undefined, TODAY), '', 'no rows at all copies nothing');
eq(nextStepsCopyHtml([], TODAY), '', 'the markup flavour is empty for the same cases');
eq(nextStepsCopyRows(null, TODAY), [], 'no rows reads as no content');

// ---- the markup flavour -----------------------------------------------------

const html = nextStepsCopyHtml(rows, TODAY);
ok(html.startsWith('<table'), 'the markup flavour is a table, which is what a spreadsheet reads');
ok(html.includes('<th') && html.includes('Waiting On'), 'the columns are named in a header row');
eq((html.match(/<tr>/g) || []).length, 3, 'one header row and one row per step');

const multiline = nextStepsCopyHtml([{ note: 'First\nSecond', waitingOn: '', doneOn: '' }], TODAY);
ok(multiline.includes('First<br>Second'), 'a line break inside a note stays inside its cell');
eq((multiline.match(/<tr>/g) || []).length, 2, 'a multi-line note is one row, not two');

const risky = nextStepsCopyHtml([{ note: '9/15 call Brian', waitingOn: '<b>Ben</b> & co', doneOn: '' }], TODAY);
ok(risky.includes("mso-number-format:'\\@'"), 'cells are marked as text, so Excel does not read a note as a date');
ok(risky.includes('&lt;b&gt;Ben&lt;/b&gt; &amp; co'), 'markup typed into a note is escaped, not rendered');
ok(!/style="[^"]*"[^>]*\\@/.test(risky), 'the text-format hint sits inside the style attribute, not after it');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
