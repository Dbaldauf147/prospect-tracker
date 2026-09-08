// Which sort a DataTable should apply when a parent fires an imperative
// `sortSignal` (see DataTable's `sortSignal` prop). Kept as a pure
// function here so the rule can be asserted without rendering the table.
//
// The signal exists so a parent can put a row back where it now belongs
// after an edit changed the value it was sorted on — the Opps 2 page
// re-ranks by Call In when a Follow Up date moves. That's a correction to
// an ordering already on screen, never a new one imposed on the user:
//
//   - No sort active → apply the signal. The rows are in whatever order
//     the parent handed them over in, which for the freeze-sorted Call In
//     column is the order it loaded them in. Re-ranking restores it.
//   - Sorted on the signal's own key → apply it, but keep the direction
//     the user chose. Re-ranking must not flip a descending sort back to
//     ascending behind their back.
//   - Sorted on some other column → ignore it. The user asked for that
//     order; a background edit (or a sync from another device) has no
//     business yanking them out of it.
//
// Returns { key, direction } to apply, or null to do nothing.
export function resolveSortSignal(internalSort, sortSignal) {
  const key = sortSignal?.key;
  if (!key) return null;
  const activeKey = internalSort?.key;
  if (activeKey && activeKey !== key) return null;
  const direction = activeKey === key
    ? (internalSort.direction === 'desc' ? 'desc' : 'asc')
    : (sortSignal.direction === 'desc' ? 'desc' : 'asc');
  return { key, direction };
}
