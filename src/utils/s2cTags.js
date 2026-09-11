// Tagging the SIA line items on the S2C tab with what they are for.
//
// The pricing workbook gives every cost a Line Item and a Type; what it never
// says is which part of the business the cost belongs to. So the page can
// answer "what does this line item cost" and can't answer "what does this
// segment cost", which is the question actually asked of it.
//
// Three tags per line item — Service Segment, Product Name, Deliverable —
// curated by hand and stored apart from the workbook, so they outlive any one
// file: a re-upload, the Clear button, removing the SIA, a parser bump.
//
// KEYED BY LINE ITEM ALONE. This is the whole point of the mapping and it is
// worth being explicit about, because it used to be keyed by (Line Item, Type)
// and that is what made the tags evaporate:
//
//   The Type is workbook data. The parser puts whatever the Type column holds
//   into it, and on a real SIA that is often fee prose carrying the deal's own
//   numbers — "Fee = $25,800 one-time estimate for...", "Fee = 3% of revenue
//   split (min. $2,500)". The next SIA for the next client has different
//   numbers, so a pair key built from it does not match, and a mapping tagged
//   against the old file silently stops applying to the new one.
//
//   The Type is also overridable per row, and the override lives on the
//   workbook's own item ids. Clearing the file drops the overrides, which
//   moved the key again — for line items nobody had touched.
//
//   And the split was wrong on its own terms. "Commercial Client Management
//   NAM" exists as both a Setup and a Recurring cost; they are separately
//   billable, which is why pass-through tagging keys the pair. But they are
//   one service, and one service belongs to one segment, one product, one
//   deliverable. Asking twice was asking the same question twice.
//
// So: a Line Item is the unit of the answer. Tag "Commercial Client Management
// NAM" once and it covers its Setup row, its Recurring row, every option, and
// every SIA that carries the name.
//
// Free text, because the vocabulary isn't settled and a managed list would
// mean nothing could be tagged until someone wrote one. What keeps free text
// from becoming forty spellings of the same segment is that each column offers
// back what has already been used.
//
// A NOTE rides alongside the three tags, in the same entry and on the same
// key, so whatever had to be said about a line item outlives the workbook the
// way its tags do. It is not a tag: it never makes a line item count as
// tagged — the heading's "2 of 7 tagged" is about the mapping being finished,
// and a note is somebody thinking out loud — but it is enough on its own to
// keep an entry, and to keep a row on the table for a line item the current
// workbook no longer carries. A note nothing can show is a note lost.

import { suggestionMatches, cellMatches } from './columnFilter.js';

export const S2C_TAG_FIELDS = [
  { key: 'serviceSegment', label: 'Service Segment' },
  { key: 'productName', label: 'Product Name' },
  { key: 'deliverable', label: 'Deliverable' },
];

const TAG_KEYS = S2C_TAG_FIELDS.map(f => f.key);

// Alongside the three tags, an entry remembers how the line item was spelled
// when it was tagged. The key is lower-cased so it can match across
// workbooks, and once the SIA is gone there is nothing else left to read a
// display name off — without this, removing the file turns a tidy table of
// names into a table of lower-case keys. Not a tag: it never makes an entry
// count as tagged, and it goes when the tags go.
const LABEL_KEY = 'label';

// The free-text note, kept beside the tags on the same entry. Like the label
// it is not a tag; unlike the label it is the user's own writing, so it is
// worth an entry of its own — see hasS2cNote.
const NOTES_KEY = 'notes';

// The Line Item key. Case- and whitespace-insensitive so the same service
// spelled with a stray trailing space in one workbook still finds its tags.
export function s2cTagKey(lineItem) {
  return String(lineItem || '').trim().toLowerCase();
}

// Does this entry carry any tag at all? An entry of three blanks is not a
// tagged line item, and must not count as one anywhere.
export function hasAnyTag(entry) {
  return TAG_KEYS.some(k => String(entry?.[k] ?? '').trim() !== '');
}

/** The note on an entry, as text. */
export function s2cNote(entry) {
  return String(entry?.[NOTES_KEY] ?? '');
}

/**
 * Is there a note here?
 *
 * Asked wherever "is this entry worth keeping" is asked. A line item with a
 * note and no tags is a line item somebody wrote something about, and
 * dropping it would throw the writing away.
 */
export function hasS2cNote(entry) {
  return s2cNote(entry).trim() !== '';
}

/** Anything on this entry worth storing — a tag, or a note. */
export function hasS2cContent(entry) {
  return hasAnyTag(entry) || hasS2cNote(entry);
}

/**
 * Fold a stored map onto Line Item keys.
 *
 * Tags saved before this were keyed "line item::type", so every one of them
 * would read as untagged now — the mapping would look wiped rather than
 * moved. This runs on load and carries them over.
 *
 * Where both halves of a line item were tagged, their entries merge, and the
 * first non-empty value for each field wins. Old keys are walked in sorted
 * order so that choice is deterministic rather than dependent on whatever
 * order the object happened to be written in. The merge is per field, so a
 * Setup row tagged with only a Segment and a Recurring row tagged with only a
 * Deliverable combine into one complete entry rather than one overwriting the
 * other.
 *
 * Returns the input untouched when there is nothing to migrate, so a load that
 * changes nothing doesn't write anything back.
 */
export function migrateS2cTags(tags) {
  const raw = tags || {};
  const keys = Object.keys(raw);
  if (!keys.some(k => k.includes('::'))) return raw;

  const out = {};
  for (const oldKey of [...keys].sort()) {
    const entry = raw[oldKey];
    if (!hasAnyTag(entry)) continue;
    // Everything before the first "::" is the Line Item half. Split on the
    // first rather than the last: a Type carrying fee prose can contain
    // anything, a Line Item is a name.
    const idx = oldKey.indexOf('::');
    const key = s2cTagKey(idx >= 0 ? oldKey.slice(0, idx) : oldKey);
    if (!key) continue;
    // Rebuilt in TAG_KEYS order rather than extended in place, so the
    // stored entry always carries its fields in the same order whichever
    // old key happened to be seen first.
    const prev = out[key] || {};
    const merged = {};
    for (const f of TAG_KEYS) {
      const v = String(prev[f] ?? '').trim() || String(entry?.[f] ?? '').trim();
      if (v) merged[f] = v;
    }
    const label = String(prev[LABEL_KEY] ?? '').trim() || String(entry?.[LABEL_KEY] ?? '').trim();
    if (label) merged[LABEL_KEY] = label;
    if (hasAnyTag(merged)) out[key] = merged;
  }
  return out;
}

/**
 * Set one tag on one line item, returning a new map.
 *
 * Empty clears: a tag typed back to blank is removed, and an entry left with
 * no tags at all drops out entirely. Otherwise the map fills up with hollow
 * entries that count as tagged everywhere they are counted.
 */
export function setS2cTag(tags, key, field, value, label) {
  const next = { ...(tags || {}) };
  const entry = { ...(next[key] || {}) };
  const trimmed = String(value ?? '').trim();
  if (trimmed) entry[field] = trimmed;
  else delete entry[field];

  // Refreshed on every edit, so a workbook that spells the line item better
  // than the one it was first tagged against updates the remembered form.
  const spelling = String(label ?? '').trim();
  if (spelling) entry[LABEL_KEY] = spelling;

  // The note keeps the entry alive on its own: clearing the last tag off a
  // line item somebody wrote a note about must not take the note with it.
  if (hasS2cContent(entry)) next[key] = entry;
  else if (key in next) delete next[key];
  else return tags || {};
  return next;
}

/**
 * Set the note on one line item, returning a new map.
 *
 * Same shape as setS2cTag, and the same emptying rule: a note typed back to
 * blank is removed, and an entry left holding neither a tag nor a note drops
 * out rather than sitting in the map as a hollow row.
 */
export function setS2cNote(tags, key, value, label) {
  const next = { ...(tags || {}) };
  const entry = { ...(next[key] || {}) };
  const trimmed = String(value ?? '').trim();
  if (trimmed) entry[NOTES_KEY] = trimmed;
  else delete entry[NOTES_KEY];

  const spelling = String(label ?? '').trim();
  if (spelling) entry[LABEL_KEY] = spelling;

  if (hasS2cContent(entry)) next[key] = entry;
  else if (key in next) delete next[key];
  else return tags || {};
  return next;
}

/**
 * Clear all three tags on one line item.
 *
 * The note stays. The button that calls this says it clears the tags, and a
 * note is the one thing on the row that can't be got back by re-reading the
 * workbook — so it takes its own deliberate emptying, in its own box.
 */
export function clearS2cTags(tags, key) {
  if (!tags || !(key in tags)) return tags || {};
  const next = { ...tags };
  const entry = { ...next[key] };
  for (const f of TAG_KEYS) delete entry[f];
  if (hasS2cNote(entry)) next[key] = entry;
  else delete next[key];
  return next;
}

/**
 * Every Line Item the loaded workbook offers, plus any line item that carries
 * tags or a note — one tagged against a workbook since replaced still needs a
 * row, or its answers are invisible and impossible to clear.
 *
 * One row per line item, however many workbook rows it spans: a service that
 * bills as both a Setup and a Recurring line is one service and is asked about
 * once. What those rows COST isn't collected — the table is the mapping, and
 * the money is on the Pricing subtab that owns it.
 *
 * Not shared with collectPassThroughPairs any more: that one is inherently
 * per-pair, because pass-through IS a property of the pair — the Setup half
 * marked up while the Recurring half passes through is a normal thing to want.
 * These two tables genuinely disagree about what a row is.
 */
export function collectS2cLineItems({ options = [], tags = {} } = {}) {
  const byKey = new Map();

  for (const opt of options) {
    for (const section of opt?.sections || []) {
      for (const item of section?.items || []) {
        const name = item?.description || '';
        const key = s2cTagKey(name);
        if (byKey.has(key) || !key) continue;
        // First spelling seen wins the display form, so the row reads the
        // way the workbook writes it rather than lower-cased.
        byKey.set(key, { key, lineItem: name.trim(), reachable: true });
      }
    }
  }

  for (const [key, entry] of Object.entries(tags || {})) {
    if (!hasS2cContent(entry) || byKey.has(key)) continue;
    // The spelling remembered when it was tagged, falling back to the key
    // for entries written before that was recorded.
    const label = String(entry[LABEL_KEY] ?? '').trim();
    byKey.set(key, { key, lineItem: label || key, reachable: false });
  }

  return [...byKey.values()].sort((a, b) => (a.lineItem || '').localeCompare(b.lineItem || ''));
}

// How many of the listed line items carry a tag. Shown in the heading so the
// size of the job left is visible without scrolling the table.
export function countTagged(rows = [], tags = {}) {
  return rows.reduce((n, r) => (hasAnyTag(tags?.[r.key]) ? n + 1 : n), 0);
}

// What a tag column offers back: every value already used in that column,
// deduped case-insensitively and sorted. The first spelling entered wins the
// display form, so the suggestion matches what is already on screen.
export function s2cTagSuggestions(tags = {}, field) {
  const seen = new Map();
  for (const entry of Object.values(tags || {})) {
    const raw = String(entry?.[field] ?? '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!seen.has(key)) seen.set(key, raw);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Add — or fill in — one line item by hand, returning a new map.
 *
 * The table's rows are the workbook's line items, which is fine right up
 * until the thing you need to tag isn't in the workbook: a service quoted
 * outside the SIA, one the parser didn't pick up, one you know is coming.
 * Before this there was no way to say so; the only line items that could be
 * tagged were the ones a file had already named.
 *
 * Merges rather than replaces, so adding a name that is already on the table
 * fills in the tags given and leaves the rest — typing an existing line item
 * in is a way to answer it, not a way to wipe it.
 *
 * Nothing is stored for a name with neither a tag nor a note against it: an
 * entry needs content to survive `hasS2cContent`, and a row that vanishes on
 * the next load is worse than a row that was never added. The caller checks
 * the return for that — an unchanged map means nothing was added.
 */
export function addS2cLineItem(tags, lineItem, values = {}) {
  const key = s2cTagKey(lineItem);
  if (!key) return tags || {};
  const next = { ...(tags || {}) };
  const entry = { ...(next[key] || {}) };

  for (const f of TAG_KEYS) {
    const v = String(values?.[f] ?? '').trim();
    if (v) entry[f] = v;
  }
  const note = String(values?.[NOTES_KEY] ?? '').trim();
  if (note) entry[NOTES_KEY] = note;

  // The spelling typed in wins the display form, the same way an edit through
  // setS2cTag refreshes it: the person adding the row is naming it.
  const spelling = String(lineItem ?? '').trim();
  if (spelling) entry[LABEL_KEY] = spelling;

  if (!hasS2cContent(entry)) return tags || {};
  next[key] = entry;
  return next;
}

/**
 * The suggestions that match what has been typed, best first — prefix
 * matches, then substrings.
 *
 * An empty query offers everything, so focusing a blank cell shows the
 * column's vocabulary rather than nothing. That is the whole reason the
 * suggestions exist: free text keeps forty spellings of one segment out only
 * if the thirty-ninth person can see the first.
 *
 * The rule itself lives in utils/columnFilter now, shared with the other
 * tables that filter a column by typing into a box under its heading. Two
 * tables that match by subtly different rules are two tables somebody has to
 * learn separately.
 */
export const s2cSuggestionMatches = suggestionMatches;

/**
 * Does one cell pass one column's filter? Blank filter passes everything,
 * and a set one matches on any part of the value — the boxes are typed into
 * as well as picked from. Shared, as above.
 */
export const s2cCellMatches = cellMatches;

// ── Column widths ─────────────────────────────────────────────────────────
//
// The table's columns hold answers of very different lengths — a segment is
// one word, a deliverable is "Sourcing - TIER 3 - Flexible Price Contract
// Structure", a note is a sentence — and which ones are long is a fact about
// the client, not about the table. So the widths are dragged, and kept.
//
// Kept on their own store key alongside the tags, and for the same reason:
// this table outlives the workbook, and a mapping that comes back after a
// Clear with its Deliverable column truncating again has not really come
// back.

const S2C_COLUMN_DEFAULT_WIDTH = {
  lineItem: 260,
  serviceSegment: 170,
  productName: 200,
  // The long one, by some distance, on every SIA seen so far.
  deliverable: 280,
  notes: 240,
};

/**
 * The table's columns, left to right, minus the × button's own strip.
 *
 * Built off S2C_TAG_FIELDS rather than repeating the three tags, so a column
 * added there is a column here — and the keys line up with the per-column
 * filters, which are keyed the same way.
 */
export const S2C_COLUMNS = [
  { key: 'lineItem', label: 'Line Item' },
  ...S2C_TAG_FIELDS,
  { key: 'notes', label: 'Notes' },
].map(c => ({ ...c, defaultWidth: S2C_COLUMN_DEFAULT_WIDTH[c.key] }));

// Narrow enough to park a column out of the way, wide enough to read a
// deliverable in full, and neither is a width a drag can leave the table in.
export const S2C_COL_MIN_WIDTH = 90;
export const S2C_COL_MAX_WIDTH = 900;

const S2C_COLUMN_BY_KEY = new Map(S2C_COLUMNS.map(c => [c.key, c]));

// A stored width as a usable number, or null for anything that isn't one.
// Number() alone won't do: it turns null, '' and false into 0, which is a
// perfectly finite number and would clamp a column to the minimum rather
// than leave it at its default — a backup file that round-tripped a missing
// width as null would come back as five squashed columns.
function asWidth(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const clampWidth = (n) => Math.min(S2C_COL_MAX_WIDTH, Math.max(S2C_COL_MIN_WIDTH, Math.round(n)));

/** The default width for one column, or undefined for a key that isn't one. */
export function s2cColumnDefaultWidth(key) {
  return S2C_COLUMN_BY_KEY.get(key)?.defaultWidth;
}

/**
 * What one column is actually rendered at.
 *
 * Anything unusable falls back to the default rather than to nothing: a
 * stored map is user data that has been through a backup file and a schema
 * change or two, and one bad number in it must not collapse a column to
 * zero and hide a mapping.
 */
export function s2cColumnWidth(widths, key) {
  const fallback = s2cColumnDefaultWidth(key);
  const raw = asWidth(widths?.[key]);
  return raw === null ? fallback : clampWidth(raw);
}

/**
 * Set one column's width, returning a new map.
 *
 * A width back at its default is stored as nothing, so the map holds only
 * what was actually changed and "reset" is a delete rather than a number that
 * has to be kept in step with the default if the default ever moves.
 */
export function setS2cColumnWidth(widths, key, px) {
  const fallback = s2cColumnDefaultWidth(key);
  if (fallback === undefined) return widths || {};
  const next = { ...(widths || {}) };
  const n = asWidth(px);
  const clamped = n === null ? fallback : clampWidth(n);
  if (clamped === fallback) {
    if (!(key in next)) return widths || {};
    delete next[key];
    return next;
  }
  if (next[key] === clamped) return widths || {};
  next[key] = clamped;
  return next;
}

/** Put one column back to its default width. */
export function resetS2cColumnWidth(widths, key) {
  return setS2cColumnWidth(widths, key, s2cColumnDefaultWidth(key));
}
