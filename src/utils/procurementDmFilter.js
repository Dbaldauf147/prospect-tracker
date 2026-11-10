// The "<Topic> DMs, open" buttons on the contacts tables (Key Contacts,
// All Contacts, Clients, Active): contacts tagged both the topic tag
// (Procurement, ESG or Capital Planning) and Decision Maker whose own tag
// status for that topic (the contact popup's Sold / Not sold,
// settings.contactTagReview) isn't Sold or Not sold.
//
// The company's Services board deliberately does NOT count: a company with
// one Procurement service Sold or Not Sold used to hide every contact there,
// which hid people Dan still wanted to work. The answer is per contact.
// Pure, so scripts/procurementDmFilter.test.mjs checks it.

import { tagKey, findTagRecord, tagRecordFrom } from './contactTagReview.js';
import { rawTagsOf } from './tagColumnFilter.js';

// The buttons, in the order they show. `tag` is the dans_tags value.
export const DM_TOPICS = [
  { key: 'procurement', label: 'Procurement', tag: 'Procurement' },
  { key: 'esg', label: 'ESG', tag: 'ESG' },
  { key: 'cap', label: 'CAP', tag: 'Capital Planning' },
];

function tagsOf(contact) {
  return new Set(rawTagsOf(contact).split(';').map(t => tagKey(t.trim())).filter(Boolean));
}

/** Tagged both `tag` and Decision Maker? */
export function isTopicDecisionMaker(contact, tag) {
  const have = tagsOf(contact);
  return have.has(tagKey(tag)) && have.has(tagKey('Decision Maker'));
}

/**
 * The contact's own `tag` status is Sold or Not sold?
 * `reviewMap` is settings.contactTagReview (contact id -> tag -> record).
 */
export function hasTopicTagSaleStatus(contact, reviewMap, tag) {
  const cid = contact?.id ?? contact?.vid;
  if (cid == null || !reviewMap) return false;
  const { status } = tagRecordFrom(findTagRecord(reviewMap[cid], tag));
  return status === 'sold' || status === 'notsold';
}

/** One button's test for one contact row (its raw HubSpot contact). */
export function isOpenTopicDecisionMaker(contact, reviewMap, tag) {
  return isTopicDecisionMaker(contact, tag) && !hasTopicTagSaleStatus(contact, reviewMap, tag);
}

/** Procurement shorthands, kept for existing callers. */
export const isProcurementDecisionMaker = c => isTopicDecisionMaker(c, 'Procurement');
export const hasProcurementTagSaleStatus = (c, m) => hasTopicTagSaleStatus(c, m, 'Procurement');
export const isOpenProcurementDecisionMaker = (c, m) => isOpenTopicDecisionMaker(c, m, 'Procurement');
