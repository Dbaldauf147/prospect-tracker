// Setting every property type in the mapping table at once.
//
// The Map property types popup lists one row per property type an upload
// carried, each mapped to one of ours. Row by row is right when a file
// carries a dozen distinct types that each mean something different — and
// wrong when they don't: a list whose types are all spellings of the same
// warehouse, a portfolio being screened as one building type, or a file
// whose Property Type column turned out to be noise and should all go to
// N/A. That was thirteen identical picks from a dropdown.
//
// So the popup can set every row at once. The draft it produces is complete
// — an entry for every row, including the ones being cleared — because the
// popup's own counters read the draft to say what is mapped, and a row
// missing from it would read as untouched rather than as cleared.
//
// Pure: no React (scripts/propertyTypeBulkMap.test.mjs).

/**
 * A draft that maps every row to `target`.
 *
 * `target` is a property type, the N/A sentinel, or '' to leave every row
 * unmapped — '' is what the popup's own per-row dropdown stores for
 * "(leave unmapped)", and what its save path reads as "drop this mapping".
 */
export function bulkMapDraft(items, target) {
  const value = target == null ? '' : String(target);
  const draft = {};
  for (const it of (items || [])) {
    const key = it?.key;
    if (!key) continue;
    draft[key] = value;
  }
  return draft;
}

/**
 * What a bulk apply would touch: how many rows, and how many sites those
 * rows account for. The site count is what the user actually cares about —
 * "13 types" is a fact about their file, "1,204 sites" is the consequence.
 */
export function bulkMapSummary(items) {
  const list = (items || []).filter(it => it?.key);
  return {
    types: list.length,
    sites: list.reduce((n, it) => n + (Number(it?.count) || 0), 0),
  };
}
