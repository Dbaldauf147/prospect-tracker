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

export const S2C_TAG_FIELDS = [
  { key: 'serviceSegment', label: 'Service Segment', placeholder: 'e.g. Sustainability' },
  { key: 'productName', label: 'Product Name', placeholder: 'e.g. ENERGY STAR Link' },
  { key: 'deliverable', label: 'Deliverable', placeholder: 'e.g. Monthly report' },
];

const TAG_KEYS = S2C_TAG_FIELDS.map(f => f.key);

// Alongside the three tags, an entry remembers how the line item was spelled
// when it was tagged. The key is lower-cased so it can match across
// workbooks, and once the SIA is gone there is nothing else left to read a
// display name off — without this, removing the file turns a tidy table of
// names into a table of lower-case keys. Not a tag: it never makes an entry
// count as tagged, and it goes when the tags go.
const LABEL_KEY = 'label';

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

  if (hasAnyTag(entry)) next[key] = entry;
  else if (key in next) delete next[key];
  else return tags || {};
  return next;
}

// Clear all three tags on one line item.
export function clearS2cTags(tags, key) {
  if (!tags || !(key in tags)) return tags || {};
  const next = { ...tags };
  delete next[key];
  return next;
}

/**
 * Every Line Item the loaded workbook offers, plus any line item that carries
 * tags — one tagged against a workbook since replaced still needs a row, or
 * the tags are invisible and impossible to clear.
 *
 * One row per line item, however many workbook rows it spans. `rowCount` is
 * how many it spans on the whole workbook and `activeCts` sums what they cost
 * on the option being shown, so a service that bills as both a Setup and a
 * Recurring line reads as one service with one total.
 *
 * Not shared with collectPassThroughPairs any more: that one is inherently
 * per-pair, because pass-through IS a property of the pair — the Setup half
 * marked up while the Recurring half passes through is a normal thing to want.
 * These two tables genuinely disagree about what a row is.
 */
export function collectS2cLineItems({ options = [], tags = {}, activeOptionNumber } = {}) {
  const byKey = new Map();

  for (const opt of options) {
    for (const section of opt?.sections || []) {
      for (const item of section?.items || []) {
        const name = item?.description || '';
        const key = s2cTagKey(name);
        if (!key) continue;
        let row = byKey.get(key);
        if (!row) {
          // First spelling seen wins the display form, so the row reads the
          // way the workbook writes it rather than lower-cased.
          row = { key, lineItem: name.trim(), options: [], rowCount: 0, activeCts: null, reachable: true };
          byKey.set(key, row);
        }
        row.rowCount += 1;
        if (opt?.sheetName && !row.options.includes(opt.sheetName)) row.options.push(opt.sheetName);
        if (opt?.optionNumber === activeOptionNumber && typeof item?.cts === 'number') {
          row.activeCts = (row.activeCts || 0) + item.cts;
        }
      }
    }
  }

  for (const [key, entry] of Object.entries(tags || {})) {
    if (!hasAnyTag(entry) || byKey.has(key)) continue;
    // The spelling remembered when it was tagged, falling back to the key
    // for entries written before that was recorded.
    const label = String(entry[LABEL_KEY] ?? '').trim();
    byKey.set(key, { key, lineItem: label || key, options: [], rowCount: 0, activeCts: null, reachable: false });
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
