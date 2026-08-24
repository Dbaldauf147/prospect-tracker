// Pull-through opps — the ones that ride along with a parent sale rather
// than running their own pipeline.
//
// They're excluded from the Days-in-Stage board and its stall flag, from
// every close rate in PipelineView, and from the "% not quoted" table:
// counting a deal that was never won on its own merits would flatter all
// four numbers. They still show in the opps table, still carry their
// dollars into Closed YTD, and still appear on the Services / Sources
// boards — being a pull-through is about close-rate honesty, not about
// hiding the work.
//
// Two ways an opp gets here. Historically it was only the Scope text —
// the service catalogue carries names like "Tax Matrix - pull through",
// so picking one said it implicitly. But that reads the whole Scope
// cell, which drops a mixed scope ("GHG, Tax Matrix - pull through") out
// of the close rate entirely, GHG and all. So there's also an explicit
// per-opp answer in the "Pull Through" column, set from the New Opp
// modal or the opp's own details, and it wins over the Scope text in
// both directions: "Yes" marks a pull-through the Scope doesn't name,
// "No" keeps a mixed-scope opp counting as a real opportunity.
//
// Lives in utils rather than beside the board so PipelineView can ask
// the same question without pulling a Kanban component into its bundle.

const PULL_THROUGH_RE = /pull[\s-]?through/i;
export const PULL_THROUGH_COLUMN = 'Pull Through';

// The explicit column value, or null when it's blank / unrecognised.
// Accepts the spellings the tri-state cells write plus the ones a pasted
// spreadsheet might carry.
function explicitPullThrough(row) {
  const v = String(row?.[PULL_THROUGH_COLUMN] ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'yes' || v === 'y' || v === 'true' || v === '✓') return true;
  if (v === 'no' || v === 'n' || v === 'false' || v === '✗') return false;
  return null;
}

// Whether an opp is a pull-through. The single answer every surface
// asks — board, stall flag, close rates — so they can't disagree.
export function isPullThroughOpp(row) {
  const explicit = explicitPullThrough(row);
  if (explicit != null) return explicit;
  return PULL_THROUGH_RE.test(String(row?.['Scope'] || ''));
}

// Why an opp is a pull-through: 'flag' when someone said so explicitly,
// 'scope' when it was only inferred from the Scope text, and null when
// it isn't one. Callers use it to tell the user whether they're looking
// at their own answer or at something the Scope decided for them, so
// "not a pull-through" has no source to report either way.
export function pullThroughSource(row) {
  if (!isPullThroughOpp(row)) return null;
  return explicitPullThrough(row) != null ? 'flag' : 'scope';
}
