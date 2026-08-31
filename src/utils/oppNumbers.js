// The "Opp #" every page shows for an opportunity.
//
// It isn't stored on the record: it's a display rank, 1..N over the opps
// currently in the dataset, ordered by the monotonically-assigned `_id`.
// Ranking rather than showing the raw `_id` keeps the column running
// 1, 2, 3… instead of exposing gaps where rows were deleted — but it
// also means every surface has to rank the same list the same way, or
// the number the Issues tab shows won't be the number the Opps tab does.
// Hence one builder, shared.
export function buildOppNumberMap(records) {
  const map = new Map();
  const ids = (records || [])
    .map(r => r?._id)
    .filter(id => id != null)
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  ids.forEach((id, idx) => map.set(id, idx + 1));
  return map;
}
