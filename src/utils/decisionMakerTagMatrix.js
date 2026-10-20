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
//
// A cell also lists the "maybes": decision makers who don't carry the tag
// but whose tag review (the contact popup's Yes / No / Not sure) says Not
// sure for it. They sit in `maybeByTag`, apart from `byTag`, so they show
// in the cell without counting as mapped - the percentages and the History
// snapshots stay on confirmed tags only.
//
// Rows also carry `saleByTag`: decision makers who don't carry the tag but
// are marked Sold or Not sold for it. A Not sold is the hold-off (the tag is
// kept off HubSpot on purpose, the area is still theirs), so it isn't shown
// or counted here, but the Zoom export treats the account as covered: see
// zoomExportRowsForTag.

import { tagKey, tagVocabulary, TAG_OPTIONS, findTagRecord, isLocalTagVerdict, tagAnswerFrom, tagRecordFrom } from './contactTagReview.js';
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
 * The decision makers in `dms` who don't carry `tag` but are marked Not
 * sure for it in the tag review (`review` is settings.contactTagReview,
 * keyed by contact id, then by tag in either spelling). Read the way the
 * All Contacts tag filter reads it, so "maybe" means the same on both pages.
 */
export function decisionMakersMaybe(dms, tag, review) {
  if (!review || typeof review !== 'object') return [];
  const k = tagKey(tag);
  return (dms || []).filter((c) => {
    if (contactTagList(c).some(t => tagKey(t) === k)) return false;
    const cid = c?.id ?? c?.vid;
    if (cid == null) return false;
    const stored = findTagRecord(review[cid], tag);
    return tagAnswerFrom(false, isLocalTagVerdict(stored) ? stored : '') === 'unsure';
  });
}

/**
 * The decision makers in `dms` who don't carry `tag` but are marked Sold or
 * Not sold for it in the tag review. Kelly Johnson at Realterm: Procurement
 * Yes + Not sold, so the tag is off her and she isn't in byTag, but her
 * company is not a gap for Procurement.
 */
export function decisionMakersSaleStatus(dms, tag, review) {
  if (!review || typeof review !== 'object') return [];
  const k = tagKey(tag);
  return (dms || []).filter((c) => {
    if (contactTagList(c).some(t => tagKey(t) === k)) return false;
    const cid = c?.id ?? c?.vid;
    if (cid == null) return false;
    return !!tagRecordFrom(findTagRecord(review[cid], tag)).status;
  });
}

/**
 * One row per account: the account itself plus `byTag`, keyed by
 * tagColumnKey, each the list of tagged decision makers there, and
 * `maybeByTag`, the Not sure ones, and `saleByTag`, the untagged Sold / Not
 * sold ones (both empty without a `review`).
 * `dmLookup` is makeDecisionMakerLookup's result.
 */
export function tagMatrixRows(accounts, dmLookup, tags, review = null) {
  return (accounts || []).map(a => {
    const dms = dmLookup ? dmLookup.forAccount(a) : [];
    const byTag = {};
    const maybeByTag = {};
    const saleByTag = {};
    for (const tag of (tags || [])) {
      const key = tagColumnKey(tag);
      byTag[key] = decisionMakersTagged(dms, tag);
      maybeByTag[key] = decisionMakersMaybe(dms, tag, review);
      saleByTag[key] = decisionMakersSaleStatus(dms, tag, review);
    }
    return { ...a, dmCount: dms.length, byTag, maybeByTag, saleByTag };
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

// The statuses a tag's Zoom export pulls from. Clients are in as well as
// Inside Sales and Qualifying: a client with nobody confirmed on the tag is
// exactly the cross-sell gap the pull is for.
export const ZOOM_TAG_EXPORT_STATUSES = ['Inside Sales', 'Qualifying', 'Client'];

// Statuses arrive from a sheet, so "Client " or "client" must still read as
// Client: Ettinger Engineering showed a Client badge on the DM Tags tab but
// was missing from the Capital Planning export on an exact match.
const statusKey = (s) => String(s || '').trim().toLowerCase();
const ZOOM_TAG_EXPORT_STATUS_KEYS = new Set(ZOOM_TAG_EXPORT_STATUSES.map(statusKey));

/** Whether a row's status reads as Qualifying, however the sheet spelled it. */
export const isQualifyingStatus = (status) => statusKey(status) === 'qualifying';

/**
 * The rows one tag's Zoom export holds: every Inside Sales, Qualifying and
 * Client account with no decision maker who is covered for the tag. Covered
 * is carrying it (a Yes, or a Sold) or being marked Sold or Not sold for it
 * (saleByTag). A Not sure no longer pulls an account in beside a covered
 * one: PNC has Robert Lincoln on Procurement, so a maybe next to him is not
 * a reason to search PNC again. An account with only maybes is still in,
 * because nobody there is covered. No decision maker at all is in.
 * `key` is tagColumnKey(tag).
 */
export function zoomExportRowsForTag(rows, key) {
  return (rows || []).filter(r => ZOOM_TAG_EXPORT_STATUS_KEYS.has(statusKey(r.status))
    && !(r.byTag?.[key] || []).length && !(r.saleByTag?.[key] || []).length);
}
