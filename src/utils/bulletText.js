// The string arithmetic behind the bulleted textareas.
//
// CommitOnBlurInput offers two bullet modes - one that bullets every line
// from the first keystroke, one that starts a list when somebody types
// "- " - and both are three edits on a string: break the line and open a
// bullet, drop an empty bullet to leave the list, and turn a typed dash
// into the glyph. Each one has to hand back where the caret goes, because
// an insertion the caret does not follow puts the next letter somewhere
// the typist did not look.
//
// They live out here so that arithmetic can be asserted under plain Node -
// see scripts/bulletText.test.mjs. Getting it wrong is the kind of bug
// that only shows up at typing speed, in somebody else's hands.

export const BULLET = '• ';

/** Is the caret on a line that is already a bullet? */
export function onBulletLine(text, caret) {
  const body = String(text ?? '');
  const lineStart = body.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  return body.slice(lineStart, caret).startsWith(BULLET);
}

/**
 * Enter on a bullet line: end it and open the next one.
 *
 * `start`/`end` are the selection, so Enter with text selected replaces it
 * the way Enter always does. Returns the whole next value and the caret,
 * which lands after the new bullet's glyph rather than before it.
 */
export function bulletBreak(text, start, end = start) {
  const body = String(text ?? '');
  const from = Math.max(0, Math.min(start, body.length));
  const to = Math.max(from, Math.min(end, body.length));
  const insertion = `\n${BULLET}`;
  return {
    next: body.slice(0, from) + insertion + body.slice(to),
    caret: from + insertion.length,
  };
}

/**
 * Enter on an EMPTY bullet: take the glyph off and leave the list.
 *
 * The convention every editor shares - a bullet you have nothing to put in
 * is how you say you are done listing. Returns null when the caret is not
 * on an empty bullet, so the caller can fall through to the ordinary
 * break.
 */
export function bulletExit(text, caret) {
  const body = String(text ?? '');
  const lineStart = body.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const lineEnd = body.indexOf('\n', caret);
  const lineEndIdx = lineEnd === -1 ? body.length : lineEnd;
  if (body.slice(lineStart, lineEndIdx) !== BULLET.trimEnd() && body.slice(lineStart, lineEndIdx) !== BULLET) return null;
  return { next: body.slice(0, lineStart) + body.slice(lineEndIdx), caret: lineStart };
}

/**
 * "- " or "* " typed at the start of a line, as the glyph instead.
 *
 * Returns null when what was just typed is not that, which is nearly every
 * keystroke - the caller only rewrites the box when there is a rewrite.
 */
export function dashToBullet(text, caret) {
  const body = String(text ?? '');
  const lineStart = body.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const segment = body.slice(lineStart, caret);
  if (segment !== '- ' && segment !== '* ') return null;
  return {
    next: body.slice(0, lineStart) + BULLET + body.slice(caret),
    caret: lineStart + BULLET.length,
  };
}
