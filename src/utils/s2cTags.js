// Tagging the SIA line items on the S2C tab with what they are for.
//
// The pricing workbook gives every cost a Line Item and a Type; what it never
// says is which part of the business the cost belongs to. So the page can
// answer "what does this line item cost" and can't answer "what does this
// segment cost", which is the question actually asked of it.
//
// Three tags per line item — Service Segment, Product Name, Deliverable —
// modelled on the Linked To page, because the problem is the same one and it
// was solved there already:
//
//   Keyed by (Line Item, Type), not by row. The same line item appears on
//   every option of a workbook and again in the next workbook. Tagging a row
//   would mean tagging it once per option and re-tagging it after every
//   upload; tagging the pair means answering once.
//
//   Stored apart from the workbook. The tags are curated by hand and outlive
//   any one file, so they survive a re-upload, the Clear button, and a parser
//   bump — the same reason the Linked To defaults live on their own key.
//
// Free text, because the vocabulary isn't settled and a managed list would
// mean nothing could be tagged until someone wrote one. What keeps free text
// from becoming forty spellings of the same segment is that each column offers
// back what has already been used.

import { passThroughPairKey, collectPassThroughPairs } from './passThroughTags.js';

export const S2C_TAG_FIELDS = [
  { key: 'serviceSegment', label: 'Service Segment', placeholder: 'e.g. Sustainability' },
  { key: 'productName', label: 'Product Name', placeholder: 'e.g. ENERGY STAR Link' },
  { key: 'deliverable', label: 'Deliverable', placeholder: 'e.g. Monthly report' },
];

const TAG_KEYS = S2C_TAG_FIELDS.map(f => f.key);

// The (Line Item, Type) key. Shared with the pass-through map rather than
// spelled out again, so both tables key the same pair the same way — and both
// match PricingView's linkedToDefaultKey, which is what the pricing table
// itself looks up.
export const s2cTagKey = passThroughPairKey;

// Does this entry carry any tag at all? An entry of three blanks is not a
// tagged line item, and must not count as one anywhere.
export function hasAnyTag(entry) {
  return TAG_KEYS.some(k => String(entry?.[k] ?? '').trim() !== '');
}

/**
 * Set one tag on one line item, returning a new map.
 *
 * Empty clears: a tag typed back to blank is removed, and an entry left with
 * no tags at all drops out entirely. Otherwise the map fills up with hollow
 * entries that count as tagged everywhere they are counted.
 */
export function setS2cTag(tags, key, field, value) {
  const next = { ...(tags || {}) };
  const entry = { ...(next[key] || {}) };
  const trimmed = String(value ?? '').trim();
  if (trimmed) entry[field] = trimmed;
  else delete entry[field];

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
 * Every (Line Item, Type) pair the loaded workbook offers, plus any pair that
 * carries tags — a pair tagged against a workbook since replaced still needs a
 * row, or the tags are invisible and impossible to clear.
 *
 * Pair collection is shared with the pass-through table (its `tagged` argument
 * is exactly "keys that must appear even when the workbook lacks them") so the
 * two tables can't end up listing different line items for the same workbook.
 */
export function collectS2cLineItems({ options = [], tags = {}, activeOptionNumber, typeOf } = {}) {
  const mustAppear = {};
  for (const [key, entry] of Object.entries(tags || {})) {
    if (hasAnyTag(entry)) mustAppear[key] = true;
  }
  return collectPassThroughPairs({
    options,
    tagged: mustAppear,
    activeOptionNumber,
    typeOf,
  }).all;
}

// How many of the listed line items carry a tag. Shown in the heading so the
// size of the job left is visible without scrolling the table.
export function countTagged(pairs = [], tags = {}) {
  return pairs.reduce((n, p) => (hasAnyTag(tags?.[p.key]) ? n + 1 : n), 0);
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
