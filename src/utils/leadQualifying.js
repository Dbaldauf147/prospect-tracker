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

// Why reachedQualifying said what it did, in words for the export's
// analysis tab: the evidence it went on, and the path of stages the opp is
// known to have taken (history in order, then where it sits today).
export function qualifyingEvidence(record) {
  const stage = String(record?.Stage ?? '').trim();
  const history = (Array.isArray(record?._stageHistory) ? record._stageHistory : [])
    .filter(h => h && String(h.stage ?? '').trim());
  const path = [...history.map(h => String(h.stage).trim()), stage || '(blank)'].join(' > ');
  if (QUALIFYING_OR_LATER.has(stage)) {
    return { reached: true, basis: `Stage today is ${stage}`, path };
  }
  const hit = history.find(h => QUALIFYING_OR_LATER.has(String(h.stage).trim()));
  if (hit) {
    const when = hit.enteredAt ? ` from ${hit.enteredAt}${hit.exitedAt ? ` to ${hit.exitedAt}` : ''}` : '';
    return { reached: true, basis: `Stage history shows ${String(hit.stage).trim()}${when}`, path };
  }
  const basis = history.length === 0
    ? `Stage today is ${stage || '(blank)'}, no stage moves recorded`
    : `Stage today is ${stage || '(blank)'}, history never shows Qualifying or later`;
  return { reached: false, basis, path };
}
