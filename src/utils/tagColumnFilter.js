// The Tags column's value filter on the contacts tables (Key Contacts and
// the pages built on it). A contact carries several tags in one
// semicolon-separated dans_tags string, so the column is filtered by tag,
// not by the whole string: the drop-down lists each tag once, and a
// contact shows when any of its tags is ticked. A contact with no tags is
// the "(blanks)" entry, the same as an empty cell in any other column.
// Pure, so scripts/tagColumnFilter.test.mjs checks it.

import { tagKey } from './contactTagReview.js';

/** The raw tag string on a contact, whichever spelling of the field it has. */
export const rawTagsOf = (c) => String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '');

/**
 * A contact's tags, one entry per tag, each in the spelling `vocabulary`
 * uses (so "decision maker" and "Decision Maker" are one value), or ['']
 * when it has none.
 */
export function tagValuesOf(c, vocabulary = []) {
  const spelling = new Map(vocabulary.map(t => [tagKey(t), t]));
  const seen = new Map();
  for (const part of rawTagsOf(c).split(';')) {
    const t = part.trim();
    if (!t) continue;
    const k = tagKey(t);
    if (!seen.has(k)) seen.set(k, spelling.get(k) || t);
  }
  return seen.size ? [...seen.values()] : [''];
}

/** Does a row with these values pass a filter ticked to `selected`? */
export const anyValueSelected = (values, selected) => values.some(v => selected.has(v));
