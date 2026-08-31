// Column preferences for the shared DataTable: which columns a user has
// hidden, deleted, and starred as their own default view.
//
// The model used to be a set of VISIBLE keys, which loses information the
// moment a page ships a new column: a key missing from the set could mean
// "the user hid it" or "it didn't exist when they last chose", and the
// table had to guess. Storing what was HIDDEN removes the guess — anything
// not on the list shows, so a column added by an update appears without
// touching what the user had set up.
//
// Stars are the user's own default view. Reset restores exactly the starred
// columns (and every deleted one), so a layout that gets disturbed is one
// click from being back rather than rebuilt column by column.

// Hidden keys for a table, given the stored prefs. `legacyVisible` is the
// old visible-key array: with no hidden list stored yet, everything in the
// current lineup that isn't on it was hidden by the user, so their screen
// stays as they left it. An empty legacy array is the "no columns visible"
// state the old loader already refused to honour — it renders a blank
// table — so it reads as "nothing hidden" here too.
export function resolveHiddenKeys({ hidden, legacyVisible, columnKeys }) {
  if (Array.isArray(hidden)) return new Set(hidden);
  if (Array.isArray(legacyVisible) && legacyVisible.length > 0) {
    const visible = new Set(legacyVisible);
    return new Set((columnKeys || []).filter(k => !visible.has(k)));
  }
  return new Set();
}

// Whether a column shows, given the user's hidden / deleted sets.
// alwaysVisible columns are the table's own scaffolding (selection
// checkboxes, drill-down buttons) and ignore both.
export function isColumnVisible(key, { hidden, removed, alwaysVisible }) {
  if (alwaysVisible?.includes(key)) return true;
  if (removed?.has(key)) return false;
  return !hidden?.has(key);
}

// What Reset restores: every deleted column back, and visibility set to the
// user's starred view. With nothing starred there's no personal default to
// restore, so it falls back to showing everything — the same thing Reset
// has always done.
export function resetToStarred({ columnKeys, starred, alwaysVisible = [] }) {
  const stars = starred instanceof Set ? starred : new Set(starred || []);
  if (stars.size === 0) return { hidden: new Set(), removed: new Set() };
  const hidden = new Set(
    (columnKeys || []).filter(k => !stars.has(k) && !alwaysVisible.includes(k)),
  );
  return { hidden, removed: new Set() };
}

// Starring a column makes it part of the user's default view, so it has to
// be on screen: un-hide and un-delete it in the same move. Un-starring only
// drops the star — a column you no longer count as a default is still one
// you're looking at right now.
export function applyStar({ key, starred, hidden, removed, star }) {
  const nextStarred = new Set(starred);
  const nextHidden = new Set(hidden);
  const nextRemoved = new Set(removed);
  if (star) {
    nextStarred.add(key);
    nextHidden.delete(key);
    nextRemoved.delete(key);
  } else {
    nextStarred.delete(key);
  }
  return { starred: nextStarred, hidden: nextHidden, removed: nextRemoved };
}

// Tables whose id used to encode their column list (deals, sites, the
// uploaded lists…) got a fresh, empty prefs bucket every time their columns
// changed — which is exactly the "all my columns came back" reset this
// model is meant to end. Their ids are stable now, so the old buckets are
// stranded under `${tableId}:<column>|<column>|…` keys.
//
// Pick the stranded bucket that best fits the table's current columns —
// most keys in common, ties to the larger set — so the layout carries over
// instead of starting from scratch one last time. Entries are
// { id, keys: [...] }; returns the winning id, or '' when nothing overlaps.
export function pickLegacyBucket(entries, columnKeys) {
  const current = new Set(columnKeys || []);
  if (current.size === 0) return '';
  let best = '';
  let bestScore = 0;
  let bestSize = 0;
  for (const entry of (entries || [])) {
    const keys = entry?.keys || [];
    let score = 0;
    for (const k of keys) if (current.has(k)) score += 1;
    if (score === 0) continue;
    if (score > bestScore || (score === bestScore && keys.length > bestSize)) {
      best = entry.id;
      bestScore = score;
      bestSize = keys.length;
    }
  }
  return best;
}
