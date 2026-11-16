// The "<Topic> DMs, open" buttons on the contacts tables (Key Contacts,
// All Contacts, Clients, Active): contacts tagged both the topic tag
// (Procurement, ESG or Capital Planning) and Decision Maker whose own tag
// status for that topic (the contact popup's Sold / Not sold,
// settings.contactTagReview) isn't Sold or Not sold.
//
// The company's Services board deliberately does NOT count: a company with
// one Procurement service Sold or Not Sold used to hide every contact there,
// which hid people Dan still wanted to work. The answer is per contact.
//
// One way back for a contact marked Not sold: their company still has a
// service carrying the topic's contact tag that is Not Sold but marked
// "Prospect" on the company card (utils/serviceProspectAnyway). Dan is still
// prospecting that service there, so its decision makers stay on the list.
// Pure, so scripts/procurementDmFilter.test.mjs checks it.

import { tagKey, findTagRecord, tagRecordFrom } from './contactTagReview.js';
import { rawTagsOf } from './tagColumnFilter.js';
import { getEffectiveServiceMetadata, parseServiceContactTags } from '../data/serviceCatalog.js';
import { PROSPECT_ANYWAY_FIELD, NOT_SOLD_STATUS } from './serviceProspectAnyway.js';

// The buttons, in the order they show. `tag` is the dans_tags value.
// `peOnly` narrows a button to contacts whose company is a PE firm (see
// isPeCompany): "PE ESG" is the ESG DMs at the firms themselves. It also
// leaves out anyone whose own Private Equity tag is answered No in the
// contact popup: Dan has said PE isn't theirs, whatever the firm is.
export const DM_TOPICS = [
  { key: 'procurement', label: 'Procurement', tag: 'Procurement' },
  { key: 'esg', label: 'ESG', tag: 'ESG' },
  { key: 'peEsg', label: 'PE ESG', tag: 'ESG', peOnly: true },
  { key: 'cap', label: 'CAP', tag: 'Capital Planning' },
];

/**
 * A Private Equity firm: the company card's Type, or its Vertical, says
 * Private Equity. Portfolio companies are not PE firms (they're owned by
 * one), so they don't count.
 */
export function isPeCompany(prospect) {
  const pe = (v) => String(v ?? '').trim().toLowerCase() === 'private equity';
  return !!prospect && (pe(prospect.type) || pe(prospect.vertical));
}

/**
 * One button's test for one contact row, with its company record.
 * `serviceOverrides` (settings.serviceOverrides) supplies each service's
 * Contact Tags, for the Prospect-anyway rule above.
 */
export function matchesDmTopic(contact, prospect, reviewMap, topic, serviceOverrides = null) {
  if (!topic) return false;
  if (topic.peOnly && !isPeCompany(prospect)) return false;
  if (topic.peOnly && hasPeAnsweredNo(contact, reviewMap)) return false;
  if (isOpenTopicDecisionMaker(contact, reviewMap, topic.tag)) return true;
  // Marked Not sold, but the company is still being prospected on the topic.
  return isTopicDecisionMaker(contact, topic.tag)
    && topicTagStatus(contact, reviewMap, topic.tag) === 'notsold'
    && companyProspectsTopic(prospect, topic.tag, serviceOverrides);
}

/**
 * The company has a service tagged `tag` (its Contact Tags) that is Not Sold
 * and marked Prospect on the card. The mark is only shown while the service
 * reads Not Sold, so a service typed as anything else on the card (Sold,
 * Quoted...) doesn't count even if the old mark is still stored; one with no
 * typed status is Not Sold through an opp, which is when the mark was set.
 */
export function companyProspectsTopic(prospect, tag, serviceOverrides = null) {
  const marks = prospect?.[PROSPECT_ANYWAY_FIELD];
  if (!marks || typeof marks !== 'object') return false;
  const want = tagKey(tag);
  for (const [name, on] of Object.entries(marks)) {
    if (!on) continue;
    const typed = String(prospect?.servicesExplored?.[name] ?? '').trim();
    if (typed && typed !== '-' && typed !== NOT_SOLD_STATUS) continue;
    const tags = parseServiceContactTags(getEffectiveServiceMetadata(name, serviceOverrides || {}).contactTags);
    if (tags.some(t => tagKey(t) === want)) return true;
  }
  return false;
}

function topicTagStatus(contact, reviewMap, tag) {
  const cid = contact?.id ?? contact?.vid;
  if (cid == null || !reviewMap) return '';
  return tagRecordFrom(findTagRecord(reviewMap[cid], tag)).status || '';
}

/** The contact's own Private Equity tag is answered No? */
export function hasPeAnsweredNo(contact, reviewMap) {
  const cid = contact?.id ?? contact?.vid;
  if (cid == null || !reviewMap) return false;
  return tagRecordFrom(findTagRecord(reviewMap[cid], 'Private Equity')).answer === 'no';
}

function tagsOf(contact) {
  return new Set(rawTagsOf(contact).split(';').map(t => tagKey(t.trim())).filter(Boolean));
}

/** Tagged both `tag` and Decision Maker? */
export function isTopicDecisionMaker(contact, tag) {
  const have = tagsOf(contact);
  return have.has(tagKey(tag)) && have.has(tagKey('Decision Maker'));
}

/**
 * The contact's own `tag` status is Sold or Not sold? N/A does not count:
 * Dan keeps an N/A decision maker on the open list.
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
