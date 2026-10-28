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
 * The two words a box can hold that aren't text to look for: "(Blanks)"
 * keeps the rows with nothing in that column, "(Non-blanks)" the rows with
 * anything. Bracketed so they can't collide with a real value, matched in
 * any case, and offered as suggestions so nobody has to know they exist.
 * A typed substring can't ask for an empty cell, and "which contacts have
 * no title / no country" is half of what a filter row gets used for.
 */
export const BLANKS_FILTER = '(Blanks)';
export const NON_BLANKS_FILTER = '(Non-blanks)';
const BLANKS_KEY = BLANKS_FILTER.toLowerCase();
const NON_BLANKS_KEY = NON_BLANKS_FILTER.toLowerCase();

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
  const blank = String(value ?? '').trim() === '';
  if (q === BLANKS_KEY) return blank;
  if (q === NON_BLANKS_KEY) return !blank;
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

/**
 * A pick-list filter's value, normalized to { picks, draft }.
 *
 * The header filter on the shared DataTable (and the PE Portfolio table that
 * borrows its cell) holds two things: the values ticked in its list, and
 * whatever is still in the search box. It hands back a bare array of picks
 * when nothing is being typed and { picks, draft } when something is; an old
 * single string is read as one pick. Blank picks are dropped.
 */
export function readPickFilter(raw) {
  let picks = [];
  let draft = '';
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (Array.isArray(raw.picks)) picks = raw.picks;
    if (typeof raw.draft === 'string') draft = raw.draft;
  } else if (Array.isArray(raw)) {
    picks = raw;
  } else if (typeof raw === 'string') {
    picks = [raw];
  }
  return {
    picks: picks.map(p => String(p ?? '').trim()).filter(Boolean),
    draft: draft.trim(),
  };
}

/** Is anything ticked or typed in a pick-list filter? */
export function pickFilterIsActive(raw) {
  const { picks, draft } = readPickFilter(raw);
  return picks.length > 0 || draft !== '';
}

/**
 * Does one cell pass a pick-list filter? An empty filter passes everything.
 *
 * Ticked values match their cell exactly (ignoring case), so ticking "Sold"
 * doesn't also keep "Not Sold"; the bracketed words keep the blank or the
 * non-blank cells, and a cell passes on any one tick. Once anything is
 * ticked the ticks decide: the search box goes back to narrowing the list
 * being ticked from, so searching "a" to find "Alpha" and ticking it shows
 * the Alpha rows rather than every row with an "a" in it. With nothing
 * ticked, what is typed narrows the rows by substring, live.
 */
export function pickFilterMatches(value, raw) {
  const { picks, draft } = readPickFilter(raw);
  const text = String(value ?? '').trim();
  const lower = text.toLowerCase();
  if (picks.length === 0) return !draft || lower.includes(draft.toLowerCase());
  return picks.some((p) => {
    const key = p.toLowerCase();
    if (key === BLANKS_KEY) return text === '';
    if (key === NON_BLANKS_KEY) return text !== '';
    return lower === key;
  });
}

/**
 * What a column's pick list offers: each distinct value in `values` with how
 * many rows hold it, in the order collectSuggestions sorts them, plus how
 * many cells are blank.
 *
 * Feed it the rows that pass every OTHER column's filter and the list shows
 * only what is actually on screen to pick from, the way a spreadsheet's
 * filter does: after Region is set to "West", Owner only offers the people
 * who own something in the West.
 */
export function pickListOptions(values = []) {
  const counts = new Map();
  let blanks = 0;
  for (const v of values) {
    const raw = String(v ?? '').trim();
    if (!raw) { blanks += 1; continue; }
    const key = raw.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const suggestions = collectSuggestions(values);
  return { suggestions, counts, blanks };
}
