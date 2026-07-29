// When duplicate account records are collapsed (see collapseDuplicateGroups),
// the loser docs are deleted and the richest keeper survives. Prospect-record
// fields are merged onto the keeper there, but a whole class of data lives
// OUTSIDE the prospect doc: settings maps keyed by account id — Target Account
// mappings (targetMap), divisions (divisionsMap / divisionRules), HQ regions
// (hqRegionMap), and anything else added later in the same shape. Those stay
// keyed to the now-deleted loser id, so a mapping the user set by hand on a
// copy that happened to lose the de-dupe silently disappears and the surviving
// row shows "— Click to map —".
//
// Given the loser→keeper remaps the de-dupe produced, move each orphaned entry
// onto the keeper and drop the dead key. The keeper wins when it already holds
// a non-empty value (its own explicit choice shouldn't be clobbered by a
// copy's); otherwise it adopts the loser's. Returns a settings patch touching
// only the changed maps (suitable for updateSettings), or null when nothing
// needs migrating.
//
// Generic over every top-level plain-object settings map, so it covers today's
// account-id-keyed maps and any future one without a hand-maintained list.
// Account ids are long random Firestore ids, so a settings map keyed by
// something else (table names, contact ids, company slugs) can't collide with
// a loser id and is left untouched.

function isEmpty(v) {
  return v === undefined || v === null || v === ''
    || (Array.isArray(v) && v.length === 0)
    || (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
}

export function migrateIdKeyedSettings(settings, remaps) {
  if (!settings || typeof settings !== 'object') return null;
  const pairs = (remaps || []).filter(r => r && r.from && r.to && r.from !== r.to);
  if (pairs.length === 0) return null;

  const patch = {};
  for (const [key, val] of Object.entries(settings)) {
    if (key.startsWith('_')) continue;          // skip metadata (e.g. _lastWriteAt)
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;

    let next = null;                             // clone lazily, only if this map is touched
    for (const { from, to } of pairs) {
      if (!Object.prototype.hasOwnProperty.call(val, from)) continue;
      if (!next) next = { ...val };
      if (isEmpty(next[to]) && !isEmpty(next[from])) next[to] = next[from];
      delete next[from];
    }
    if (next) patch[key] = next;
  }
  return Object.keys(patch).length ? patch : null;
}
