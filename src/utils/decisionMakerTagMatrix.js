// The My Accounts "DM Tags" subtab: one row per account, one column per
// contact tag, and in each cell the decision makers at that account who
// carry that tag as well.
//
// A contact lands in a cell only when they are tagged Decision Maker AND
// the column's tag. Who counts as a decision maker at an account is the
// shared rule (utils/decisionMakerCoverage.js makeDecisionMakerLookup):
// Hide / Left / Schneider excluded, the fuzzy company match, plus whoever
// the account's Contacts tab adds by email domain or by hand. So an
// account with no decision maker on the Prospecting ladder has an empty
// row here, and the two pages can't disagree.
//
// Above each column, how much of each tier is mapped for that tag: the
// share of the Tier 1 / 2 / 3 accounts on screen that have at least one
// such contact.

import { tagKey, tagVocabulary, TAG_OPTIONS } from './contactTagReview.js';
import { TIERS } from '../data/enums.js';

// Tags that are never a column. Decision Maker is the gate every cell
// already applies, Hide and Left keep a contact off the page entirely, and
// Test is scaffolding.
const NOT_A_COLUMN = new Set(['Decision Maker', 'Hide', 'Left', 'Test'].map(tagKey));

/** A contact's tags, as written (split on HubSpot's `;`). */
export function contactTagList(c) {
  return String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '')
    .split(';').map(t => t.trim()).filter(Boolean);
}

/**
 * The tag columns: the tag vocabulary plus any tag a contact carries that
 * the vocabulary doesn't, one spelling per tag, minus the tags above.
 */
export function tagMatrixColumns(contacts, tagOptions = TAG_OPTIONS) {
  const extra = [];
  for (const c of (contacts || [])) extra.push(...contactTagList(c));
  return tagVocabulary(extra, tagOptions).filter(t => !NOT_A_COLUMN.has(tagKey(t)));
}

/** Stable DataTable column key for a tag, so stars and widths survive a respelling. */
export function tagColumnKey(tag) {
  return `tag:${tagKey(tag)}`;
}

/**
 * The decision makers in `dms` who also carry `tag`. Matched on tagKey, so
 * "Efficiency/Renewables" fills the "Efficiency / Renewables" column.
 */
export function decisionMakersTagged(dms, tag) {
  const k = tagKey(tag);
  return (dms || []).filter(c => contactTagList(c).some(t => tagKey(t) === k));
}

/**
 * One row per account: the account itself plus `byTag`, keyed by
 * tagColumnKey, each the list of tagged decision makers there.
 * `dmLookup` is makeDecisionMakerLookup's result.
 */
export function tagMatrixRows(accounts, dmLookup, tags) {
  return (accounts || []).map(a => {
    const dms = dmLookup ? dmLookup.forAccount(a) : [];
    const byTag = {};
    for (const tag of (tags || [])) byTag[tagColumnKey(tag)] = decisionMakersTagged(dms, tag);
    return { ...a, dmCount: dms.length, byTag };
  });
}

// A tier is mapped only when every account in it is, so the percentage
// never rounds up to 100 while one is still missing. The ladder's rule.
function pctMapped(mapped, total) {
  if (!total) return null;
  if (mapped >= total) return 100;
  return Math.min(99, Math.round((mapped / total) * 100));
}

/**
 * Per tag column, per tier: { total, mapped, pct } over the rows given.
 * `tierOf(row)` reads the row's tier (My Accounts keeps it in `myTier`).
 * A tier with no accounts reads pct null.
 */
export function tagMatrixCoverage(rows, tags, tierOf = r => r.myTier) {
  const out = {};
  for (const tag of (tags || [])) {
    const key = tagColumnKey(tag);
    const byTier = {};
    for (const tier of TIERS) {
      let total = 0;
      let mapped = 0;
      for (const r of (rows || [])) {
        if (tierOf(r) !== tier) continue;
        total += 1;
        if ((r.byTag?.[key] || []).length > 0) mapped += 1;
      }
      byTier[tier] = { total, mapped, pct: pctMapped(mapped, total) };
    }
    out[key] = byTier;
  }
  return out;
}
