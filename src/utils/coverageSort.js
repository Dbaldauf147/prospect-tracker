// Sorting for the Draft Emails Variable Coverage table.
//
// sort is null (the order the recipients were added in) or
// { key, dir } with dir 1 for A to Z and -1 for Z to A.

// A header click: unsorted -> A to Z -> Z to A -> unsorted. Clicking a
// different column starts it at A to Z.
export function nextCoverageSort(sort, key) {
  if (!sort || sort.key !== key) return { key, dir: 1 };
  return sort.dir === 1 ? { key, dir: -1 } : null;
}

// rows in sort order, as a new array. valueOf(row, key) gives the text a
// cell shows. Blank cells always sink to the bottom, either direction: they
// are the gaps, and flipping the order should not bury the filled rows
// under them. Ties keep the order the rows came in.
export function sortCoverageRows(rows, sort, valueOf) {
  const list = Array.isArray(rows) ? rows : [];
  if (!sort) return list;
  const keyed = list.map((row, i) => ({ row, i, v: String(valueOf(row, sort.key) ?? '').trim() }));
  keyed.sort((a, b) => {
    if (!a.v || !b.v) return (a.v ? 0 : 1) - (b.v ? 0 : 1) || a.i - b.i;
    return sort.dir * a.v.localeCompare(b.v, undefined, { numeric: true, sensitivity: 'base' }) || a.i - b.i;
  });
  return keyed.map(k => k.row);
}
