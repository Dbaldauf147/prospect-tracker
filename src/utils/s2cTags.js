// Tagging a Costs to Serve row with what it is for.
//
// The S2C worksheet is a cost block pasted out of Excel: an element, what it
// costs to set up, what it costs per month. What it never said is which part
// of the business the cost belongs to — so a worksheet answers "what does this
// cost" and can't answer "what does this segment cost", which is the question
// that gets asked of it.
//
// Three tags per row: Service Segment, Product Name, Deliverable. Free text,
// because nobody knows the final vocabulary yet and a strict list would mean
// nothing can be tagged until someone writes one. What keeps free text from
// becoming forty spellings of the same thing is that each column offers back
// what the sheet already uses — so the second row is picked from a list even
// though the first had to be typed.
//
// The rule that matters is on re-paste. The cost block gets refreshed from
// Excel regularly and that paste replaces every row; tags live only here, so a
// refresh would silently throw away all the tagging. Instead the tags are
// carried across by Cost Element: a row that comes back under the same name
// keeps what it was tagged with, and only genuinely new elements arrive blank.

export const S2C_TAG_FIELDS = [
  { key: 'serviceSegment', label: 'Service Segment', placeholder: 'e.g. Sustainability' },
  { key: 'productName', label: 'Product Name', placeholder: 'e.g. ENERGY STAR Link' },
  { key: 'deliverable', label: 'Deliverable', placeholder: 'e.g. Monthly report' },
];

const TAG_KEYS = S2C_TAG_FIELDS.map(f => f.key);

// Cost Elements are matched on trimmed, case-folded text — the same name
// re-exported from Excel with different casing or a trailing space is the same
// cost, and losing its tags to whitespace would be the least explicable
// version of this going wrong.
export function costElementKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

// Does this row carry any tag at all? Used to decide whether a row is worth
// remembering across a paste.
export function hasTags(row) {
  return TAG_KEYS.some(k => String(row?.[k] ?? '').trim() !== '');
}

/**
 * Carry existing tags onto a freshly pasted block, matched on Cost Element.
 *
 * @param {Array} pastedRows  Rows straight out of the paste parser.
 * @param {Array} previousRows The rows on screen before the paste.
 * @returns {Array} the pasted rows, tagged where a name matches.
 */
export function carryTagsOnPaste(pastedRows = [], previousRows = []) {
  const byElement = new Map();
  for (const row of previousRows) {
    const key = costElementKey(row?.costElement);
    // A blank Cost Element names nothing, so it can't be matched to anything.
    if (!key || !hasTags(row)) continue;
    // First tagged row wins. A sheet listing the same element twice has one
    // answer for what it is, and taking the last would depend on row order.
    if (!byElement.has(key)) byElement.set(key, row);
  }
  if (byElement.size === 0) return pastedRows;

  return pastedRows.map(row => {
    const prev = byElement.get(costElementKey(row?.costElement));
    if (!prev) return row;
    const next = { ...row };
    for (const k of TAG_KEYS) {
      const v = String(prev[k] ?? '').trim();
      if (v) next[k] = prev[k];
    }
    return next;
  });
}

// What a tag column offers back: every value the sheet already uses in that
// column, deduped case-insensitively and sorted. The first spelling entered
// wins the display form, so the suggestion matches what is already on screen.
export function tagSuggestions(rows = [], field) {
  const seen = new Map();
  for (const row of rows) {
    const raw = String(row?.[field] ?? '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!seen.has(key)) seen.set(key, raw);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
