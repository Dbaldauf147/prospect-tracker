// Conflict resolution for user settings when two devices both touched
// the same key. Lifted out of useUserSettings so the heuristics can be
// exercised directly (scripts/settingsMerge.test.mjs) — they're pure
// functions with no Firestore or React involvement.

// Array-valued keys whose value is a complete SNAPSHOT of a selection
// rather than an accumulating list. The primitive-array union below is
// wrong for these: it resurrects whatever the user just removed, because
// the removed entry still sits in the remote copy and gets appended back.
// Ours wins instead — the device that just made the edit is right about
// that selection.
//
// `nfatSchedules.<type>.days` is the weekday set for a "No Further Action
// Today" clear schedule. Unioning it silently WIDENED the schedule:
// narrow it to Mon/Wed on the laptop while the desktop still had Mon-Fri
// and the merge handed back Mon-Fri, so days the user had just switched
// off kept clearing the column. Its siblings (`enabled`, `time`,
// `lastRunAt`) already resolve ours-wins by falling through to the
// bottom of autoMergeValue — `days` was the odd one out.
//
// `tablePrefs.visible` is the same class of bug; it predates this and has
// its own carve-out in mergeTablePrefs, which never reaches this path.
const SNAPSHOT_ARRAY_KEYS = new Set(['days']);

// Best-effort merge for a single setting key when two devices both
// touched it. The goal is to never lose data without being asked, so
// we use structural rules rather than always letting one side win:
//
//   * snapshot arrays (see above)
//     → ours wins outright.
//   * arrays of objects with stable ids (rows in zoomInfo, opps, etc.)
//     → union by id, ours wins on same id (last-edit-on-this-device).
//   * arrays of primitives (customTypes, hiddenServices)
//     → dedup union, preserving our order then appending remote-only.
//   * plain objects (dismissedGuesses, contactLocalFields, …)
//     → recursive shallow merge: ours wins on overlapping leaf keys.
//   * anything else (strings, numbers, bool, mixed arrays)
//     → ours wins, since we just made the edit on this device.
//
// `key` is the settings key (or, when recursing, the nested property
// name) the value sits under. Only the snapshot-array rule uses it.
export function autoMergeValue(ours, remote, key) {
  if (remote === undefined) return ours;
  if (ours === undefined) return remote;
  if (Array.isArray(ours) && Array.isArray(remote)) {
    if (key != null && SNAPSHOT_ARRAY_KEYS.has(key)) return ours;
    const idOf = (x) => (x && typeof x === 'object' ? (x.id ?? x._id ?? null) : null);
    const oursAllIded = ours.length === 0 || ours.every(x => idOf(x) != null);
    const remoteAllIded = remote.length === 0 || remote.every(x => idOf(x) != null);
    if (oursAllIded && remoteAllIded) {
      const ourIds = new Set(ours.map(idOf));
      const result = [...ours];
      for (const r of remote) if (!ourIds.has(idOf(r))) result.push(r);
      return result;
    }
    const allPrim = ours.every(x => x === null || typeof x !== 'object')
      && remote.every(x => x === null || typeof x !== 'object');
    if (allPrim) {
      const norm = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
      const seen = new Set(ours.map(norm));
      const result = [...ours];
      for (const v of remote) {
        const k = norm(v);
        if (!seen.has(k)) { seen.add(k); result.push(v); }
      }
      return result;
    }
    return ours;
  }
  if (ours && remote && typeof ours === 'object' && typeof remote === 'object'
      && !Array.isArray(ours) && !Array.isArray(remote)) {
    const out = { ...remote };
    for (const k of Object.keys(ours)) out[k] = autoMergeValue(ours[k], remote[k], k);
    return out;
  }
  return ours;
}

// Table-layout prefs (settings.tablePrefs) get their own merge instead
// of autoMergeValue. Each table's `visible` is a complete snapshot of
// the columns currently shown — the generic primitive-array union above
// would resurrect any column the user just hid, because the removed key
// still sits in the remote array and gets appended back. Merge per
// table with ours-wins-per-field: the device that just touched a
// table's layout is right about that layout, and tables only the other
// device touched flow through from remote untouched.
export function mergeTablePrefs(ours, remote) {
  const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isMap(ours)) return remote === undefined ? ours : remote;
  if (!isMap(remote)) return ours;
  const out = { ...remote };
  for (const tableId of Object.keys(ours)) {
    const o = ours[tableId];
    const r = remote[tableId];
    out[tableId] = (isMap(o) && isMap(r)) ? { ...r, ...o } : o;
  }
  return out;
}

// Merge one settings key, routing tablePrefs to its own rule. Shared by
// the whole-key and dotted-path save paths so both resolve identically.
export function mergeSettingsKey(key, ours, remote) {
  return key === 'tablePrefs' ? mergeTablePrefs(ours, remote) : autoMergeValue(ours, remote, key);
}

// Fold a finished write's result into the state the app holds NOW.
//
// A save takes a Firestore round trip and the user keeps working during it.
// Rebuilding local state from the snapshot taken BEFORE that round trip threw
// away everything they did while it was in flight — which is how an answer
// clicked on the contact popup's tag table while the previous click was still
// saving un-clicked itself a second later.
//
//   base      what this write says the document now holds
//   snapshot  the state this write started from
//   current   what the app is holding at the moment the write settles
//
// A key whose current value has moved on from the snapshot was changed after
// this write began, so the newer value wins: its own save is already on its
// way, and this one has nothing newer to say about it. Everything else comes
// from `base`, so a remote change folded in by the caller still lands.
export function foldWriteResult(base, snapshot, current) {
  const next = { ...base };
  const was = snapshot || {};
  for (const [k, v] of Object.entries(current || {})) {
    if (k === '_lastWriteAt') continue;
    if (v !== was[k]) next[k] = v;
  }
  return next;
}
