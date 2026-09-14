// Assertion tests for the bulleted textareas' string arithmetic - the
// One-pager Notes box and every other field that bullets as you type.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/bulletText.test.mjs
//
// Each of these hands back a caret as well as a string, and the caret is
// the half that is easy to get wrong and impossible to see in a diff: an
// insertion the caret does not follow puts the next letter somewhere the
// typist did not look. At typing speed that reads as the box scrambling
// the line, which is exactly what it used to do.
import { BULLET, bulletBreak, bulletExit, dashToBullet, onBulletLine } from '../src/utils/bulletText.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; } else { failed += 1; console.error(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── breaking a line and opening the next bullet ──────────────────────────
{
  const text = `${BULLET}Chiller RFP lands in Q1`;
  const { next, caret } = bulletBreak(text, text.length);
  eq(next, `${BULLET}Chiller RFP lands in Q1\n${BULLET}`, 'Enter ends the line and opens a bullet');
  eq(caret, next.length, 'with the caret after the new glyph, ready for the next word');
  // The next word has to land AT the caret, or the line scrambles.
  eq(next.slice(0, caret) + 'Wants sub-metering',
    `${BULLET}Chiller RFP lands in Q1\n${BULLET}Wants sub-metering`,
    'so what is typed next continues the new bullet');

  // Mid-line: the rest of the line goes with the new bullet, the way Enter
  // behaves in every editor.
  const mid = bulletBreak(`${BULLET}one two`, (BULLET + 'one').length);
  eq(mid.next, `${BULLET}one\n${BULLET} two`, 'a break mid-line carries the rest down');

  // Enter with something selected replaces it.
  eq(bulletBreak('abcdef', 1, 4).next, `a\n${BULLET}ef`, 'a selection is replaced by the break');
  // Out-of-range offsets are clamped rather than producing "undefined".
  eq(bulletBreak('abc', 99).next, `abc\n${BULLET}`, 'a caret past the end is the end');
  eq(bulletBreak(null, 0).next, `\n${BULLET}`, 'and no text at all still breaks cleanly');
}

// ── leaving the list ─────────────────────────────────────────────────────
{
  const text = `${BULLET}one\n${BULLET}`;
  const exit = bulletExit(text, text.length);
  eq(exit, { next: `${BULLET}one\n`, caret: `${BULLET}one\n`.length }, 'an empty bullet is dropped, ending the list');
  eq(bulletExit(`${BULLET}one`, 3), null, 'a bullet with something in it is not an exit');
  eq(bulletExit('plain text', 4), null, 'and neither is a line that was never a bullet');
}

// ── which line the caret is on ───────────────────────────────────────────
{
  const text = `${BULLET}one\nplain`;
  eq(onBulletLine(text, 3), true, 'the first line is a bullet');
  eq(onBulletLine(text, text.length), false, 'the second is not');
  eq(onBulletLine('', 0), false, 'an empty box is not a bullet line');
}

// ── a typed dash becomes the glyph ───────────────────────────────────────
{
  eq(dashToBullet('- ', 2), { next: BULLET, caret: BULLET.length }, '"- " at the start of a line is a bullet');
  eq(dashToBullet('* ', 2), { next: BULLET, caret: BULLET.length }, 'so is "* "');
  eq(dashToBullet('one\n- ', 6), { next: `one\n${BULLET}`, caret: `one\n${BULLET}`.length }, 'on any line, not just the first');
  // Nearly every keystroke is not this, and the box is only rewritten when
  // there is a rewrite.
  eq(dashToBullet('a- ', 3), null, 'a dash mid-word is a dash');
  eq(dashToBullet('-', 1), null, 'a dash on its own is not a bullet yet');
  eq(dashToBullet('10 - 20 years', 6), null, 'and a dash inside a sentence is left alone');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
