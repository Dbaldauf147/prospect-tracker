// What an opportunity's Stage means: is this deal still live?
//
// The answer was written out longhand in half a dozen places — the
// contacts pages, the progress math, the target-accounts index — and
// each copy was free to drift. This is the one definition; import it
// rather than re-typing a Set of stage names.
//
// Import-free on purpose, so the modules that must stay loadable under
// plain Node (tryingAgain.js and its tests) can use it too.

// Stages that mean the opp is finished, won or lost. "Closed" and "Lost"
// are older spellings that still appear in imported rows.
export const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);

// Not stages at all: spreadsheet error values and the placeholders a
// blank cell picks up on the way through an export.
export const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

/** Is this opp still in play — neither closed nor a broken cell? */
export function isActiveOppStage(stage) {
  const s = String(stage || '').trim();
  return !!s && !INVALID_STAGES.has(s) && !CLOSED_STAGES.has(s);
}

/** Is this a real stage at all (live or closed), as opposed to a broken cell? */
export function isRealOppStage(stage) {
  const s = String(stage || '').trim();
  return !!s && !INVALID_STAGES.has(s);
}
