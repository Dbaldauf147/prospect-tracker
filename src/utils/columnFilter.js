// Per-column filters that suggest what the column already holds.
//
// A table with a box under every heading is only useful if the box knows the
// column: "what went to Warburg Pincus" should not mean remembering how
// Warburg Pincus was spelled, and "who bounced" should not mean knowing that
// the word is "Failed". So a column filter is a text box that offers back
// the values actually in that column, narrowed as you type.
//
// The matching rules started on the S2C line-item table (utils/s2cTags.js,
// which now calls through to here) and are shared rather than copied: two
// tables that filter by different rules are two tables somebody has to learn
// separately, and the one that gets it subtly wrong is the one nobody
// notices. Everything here is pure — values in, verdict out
// (scripts/columnFilter.test.mjs).

/**
 * The suggestions that match what has been typed, best first.
 *
 * Prefix matches lead, substring matches follow, each group keeping the
 * order it arrived in. Typing "no" should put "No Reply" above "Out of
 * Office" — a prefix is what somebody spelling out a value they half
 * remember is producing.
 *
 * An empty query offers everything, so focusing a blank box shows the
 * column's vocabulary rather than nothing. That is most of the point: the
 * list is how you find out that "Out of Office" is a status at all.
 */
export function suggestionMatches(values = [], query = '') {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [...values];
  const starts = [], contains = [];
  for (const v of values) {
    const lower = String(v).toLowerCase();
    if (lower.startsWith(q)) starts.push(v);
    else if (lower.includes(q)) contains.push(v);
  }
  return [...starts, ...contains];
}

/**
 * Does one cell pass one column's filter? A blank filter passes everything.
 *
 * Substring rather than equality on purpose: the boxes are typed into as
 * well as picked from, so half a name has to narrow the table — otherwise
 * typing does nothing until the last character lands.
 */
export function cellMatches(value, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return String(value ?? '').toLowerCase().includes(q);
}

/**
 * What a column offers back: every value in it, deduped case-insensitively
 * and sorted, blanks dropped.
 *
 * The first spelling seen wins the display form, so the suggestion matches
 * what is already on screen. Numbers sort by their text like everything else
 * — these are the words in a column, not a series.
 */
export function collectSuggestions(values = []) {
  const seen = new Map();
  for (const v of values) {
    const raw = String(v ?? '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!seen.has(key)) seen.set(key, raw);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Does a row pass every filter that is set?
 *
 * `values` is the row as the columns show it, keyed by column; `filters` is
 * what has been typed, keyed the same way. AND, not OR: each box narrows
 * what the last one left, which is what a row of boxes reads as.
 *
 * A filter on a column the row has no value for fails that row rather than
 * passing it — asking for Company "Acme" must not hand back the rows whose
 * company is blank.
 */
export function rowMatchesFilters(values = {}, filters = {}) {
  for (const [key, query] of Object.entries(filters || {})) {
    if (String(query ?? '').trim() === '') continue;
    if (!cellMatches(values?.[key], query)) return false;
  }
  return true;
}

/** How many filters are actually set — what a "Clear filters (3)" counts. */
export function activeFilterCount(filters = {}) {
  return Object.values(filters || {}).filter(v => String(v ?? '').trim() !== '').length;
}

/** Drop one column's filter, returning a new map (or the same one if it was already clear). */
export function clearFilter(filters, key) {
  if (String(filters?.[key] ?? '') === '') return filters || {};
  const next = { ...(filters || {}) };
  delete next[key];
  return next;
}

/**
 * Keep only the filters whose columns are still on screen.
 *
 * A filter left running on a column the user has just hidden takes rows off
 * the table with nothing visible to explain why — the one failure mode a row
 * of filter boxes has. Returns the same object when nothing needs dropping,
 * so it is safe to call on every render.
 */
export function filtersForColumns(filters, columnKeys = []) {
  const keep = new Set(columnKeys);
  const current = filters || {};
  if (Object.keys(current).every(k => keep.has(k))) return current;
  const next = {};
  for (const [k, v] of Object.entries(current)) if (keep.has(k)) next[k] = v;
  return next;
}
