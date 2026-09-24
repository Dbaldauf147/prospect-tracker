// Assertion tests for the service notes' two storage shapes: legacy plain
// text and the Quill markup the Services popup now saves.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/richNotes.test.mjs
import { isNotesHtml, toNotesHtml, notesPlainText } from '../src/utils/richNotes.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; } else { failed += 1; console.error(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── telling the shapes apart ─────────────────────────────────────────────
eq(isNotesHtml('<p>Cost <strong>only</strong></p>'), true, 'Quill markup is markup');
eq(isNotesHtml('Typical Cass waste bill'), false, 'a plain note is not');
eq(isNotesHtml('Priced for <5 sites & >2 years'), false, 'angle brackets in prose are not markup');
eq(isNotesHtml(''), false, 'an empty note is not');
eq(isNotesHtml(undefined), false, 'a missing note is not');

// ── loading a legacy note into the editor ────────────────────────────────
eq(toNotesHtml('Line one\nLine two'), '<p>Line one</p><p>Line two</p>', 'one paragraph per line');
eq(toNotesHtml('A\n\nB'), '<p>A</p><p><br></p><p>B</p>', 'blank lines survive');
eq(toNotesHtml('<5 sites & more'), '<p>&lt;5 sites &amp; more</p>', 'prose is escaped, not parsed');
eq(toNotesHtml('<p><em>kept</em></p>'), '<p><em>kept</em></p>', 'markup passes through untouched');
eq(toNotesHtml(''), '', 'empty stays empty');

// ── the words alone ──────────────────────────────────────────────────────
eq(notesPlainText('<p>Cost <strong>only</strong></p><p>in RA</p>'), 'Cost only\nin RA', 'tags drop, paragraphs break');
eq(notesPlainText('<p>A &amp; B&nbsp;&lt;C&gt;</p>'), 'A & B <C>', 'entities decode');
eq(notesPlainText('<p><br></p>'), '', 'an emptied editor reads as empty');
eq(notesPlainText('Plain\ntext'), 'Plain\ntext', 'a legacy note is already plain');
eq(notesPlainText('<p>x</p>').includes('strong'), false, 'search never matches tag names');

console.log(`${failed ? 'FAIL' : 'PASS'}  richNotes: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
