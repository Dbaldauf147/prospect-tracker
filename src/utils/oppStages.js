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

// How far along the pipeline a live stage is, for "which of these opps is
// furthest along". Ordered as the Days-in-Stage board orders its columns
// (components/OppsView2/daysInStage.jsx) — pipeline progression, not
// alphabetical. Repricing sits with Quoted: a re-quote is a quote again.
// Closed stages are absent on purpose; this ranks the live ones.
export const ACTIVE_STAGE_RANK = {
  'Not Started': 1,
  'Lead': 2,
  'Qualifying': 3,
  'Quoting': 4,
  'Quoted': 5,
  'Repricing': 5,
  'Contracting': 6,
  'Agreement Sent': 7,
};

/** Where a stage sits in that progression; 0 for anything unrecognised. */
export function activeStageRank(stage) {
  return ACTIVE_STAGE_RANK[String(stage || '').trim()] ?? 0;
}

/** Is this a real stage at all (live or closed), as opposed to a broken cell? */
export function isRealOppStage(stage) {
  const s = String(stage || '').trim();
  return !!s && !INVALID_STAGES.has(s);
}
