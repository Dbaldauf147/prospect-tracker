// PE engagement stages as the app paints them: one palette per stage, and
// the rule that turns a firm's stored `peStage` into one of them.
//
// A firm with nothing stored reads as Lead. It used to read as
// "Unassigned" — a bucket outside the pipeline that said nothing about the
// firm and left every board with a column of firms nobody had triaged. A
// PE firm on the roster is a lead until it becomes something else, so Lead
// is the entry stage and the fallback. The PE Portfolio board writes the
// field itself on load (see PEPortfolioView's backfill), so a stored blank
// only survives until the next time that board is open.
//
// This lives next to the enum rather than inside PEPortfolioView because
// three boards, the Portfolio table column and the emailed workbook all
// paint the same chips, and the palette had already been copied twice.
import { NOT_SOLD_STATUS, PE_STAGES } from '../data/enums.js';

// The stage a firm gets when it has none stored. First in PE_STAGES too,
// so it also leads the board columns and the stage sort.
export const PE_DEFAULT_STAGE = 'Lead';

export const PE_STAGE_META = [
  { stage: 'Lead', accent: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
  { stage: 'Discovery', accent: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' },
  { stage: 'Piloting', accent: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
  { stage: 'Existing Partnership', accent: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  { stage: 'Not Sold', accent: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
];

// A firm's stage as one of the five above — anything unrecognised (blank,
// or a value retired from PE_STAGES) reads as Lead rather than dropping
// the firm out of the pipeline.
export function peStageOf(peStage) {
  return PE_STAGES.includes(peStage) ? peStage : PE_DEFAULT_STAGE;
}

export function peStageMeta(peStage) {
  const stage = peStageOf(peStage);
  return PE_STAGE_META.find(m => m.stage === stage) || PE_STAGE_META[0];
}

// The stage that says the firm has given its answer — the end of the
// pipeline, and the stage a written-off firm belongs at.
export const PE_NOT_SOLD_STAGE = 'Not Sold';

/**
 * The one disagreement a PE firm's two "did this land?" fields can get
 * into: a Status of "Lost - Not Sold" on the company record while the PE
 * Stage still reads as a live relationship.
 *
 * They are two fields saying the same thing in two places (peFirmOutreach
 * makes the same point), and every rule that reads one of them reads it
 * alone: the Prospecting ladder's step 6 drops a firm that fails either
 * test, the PE boards bucket by stage only. So a firm written off in one
 * place and mid-Discovery in the other is counted as both, and nothing
 * used to say so.
 *
 * Returns null when there is nothing to flag, or { status, stage } naming
 * the two values in conflict. A blank stage reads as Lead through
 * peStageOf, so a written-off firm nobody ever staged is flagged too:
 * Lead is a live stage, and that firm is exactly the stale row this is
 * for.
 *
 * Deliberately one-directional. A firm at PE Stage "Not Sold" whose
 * Status is something else is not flagged: the firm can pass on a
 * partnership and still be a perfectly live account (a portfolio company
 * of it might be the client), so that pair is a real state rather than a
 * contradiction.
 */
export function peStageStatusConflict(prospect) {
  const status = String(prospect?.status || '').trim();
  if (status !== NOT_SOLD_STATUS) return null;
  const stage = peStageOf(prospect?.peStage);
  if (stage === PE_NOT_SOLD_STAGE) return null;
  return { status, stage };
}
