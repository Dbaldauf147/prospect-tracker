// React key for one DataTable body row.
//
// Rows are keyed on `id`, and opp ids are small integers (1, 2, 3, …).
// A row with no `id` used to fall back to its bare position in the list,
// and React stringifies keys, so the row at position 57 collided with the
// opp whose id is 57. Duplicate keys make React lose track of rows: it
// leaves orphaned copies in the DOM that sit in stale places, show stale
// values and ignore clicks. The Opps table hit this through its scheduled
// placeholder rows, which carry only `_id`.
//
// So: `id`, then `_id`, then a position key in its own namespace that no
// real id can equal.
export function tableRowKey(row, index) {
  if (row?.id != null) return row.id;
  if (row?._id != null) return row._id;
  return `__pos:${index}`;
}
