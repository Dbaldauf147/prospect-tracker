// Did an opp ever make it to the Qualifying stage?
//
// Yes when it sits at Qualifying or any stage past it today, or when its
// stage history (`_stageHistory`, one entry per stage it has left) shows it
// passing through one. A lost deal only counts on that history: "Not Sold"
// says how it ended, not how far it got. Sold counts outright, because a
// deal that closed went through qualifying whether or not anybody moved the
// stage by hand on the way.
//
// The history only exists since stage moves started being recorded, which
// is why the Leads chart asks this of the current year only: an older opp
// that died at Qualifying left no trace of it.

export const QUALIFYING_OR_LATER = new Set([
  'Qualifying', 'Quoting', 'Quoted', 'Contracting', 'Agreement Sent', 'Verbal', 'Sold', 'Won',
]);

export function reachedQualifying(record) {
  const stage = String(record?.Stage ?? '').trim();
  if (QUALIFYING_OR_LATER.has(stage)) return true;
  const history = Array.isArray(record?._stageHistory) ? record._stageHistory : [];
  return history.some(h => QUALIFYING_OR_LATER.has(String(h?.stage ?? '').trim()));
}
