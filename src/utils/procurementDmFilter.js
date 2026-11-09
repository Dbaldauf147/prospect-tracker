// The "Procurement DMs, open" button on the contacts tables (Key Contacts,
// All Contacts, Clients, Active): contacts tagged both Procurement and
// Decision Maker whose own Procurement tag status (the contact popup's
// Sold / Not sold, settings.contactTagReview) isn't Sold or Not sold.
//
// The company's Services board deliberately does NOT count: a company with
// one Procurement service Sold or Not Sold used to hide every contact there,
// which hid people Dan still wanted to work. The answer is per contact.
// Pure, so scripts/procurementDmFilter.test.mjs checks it.

import { tagKey, findTagRecord, tagRecordFrom } from './contactTagReview.js';
import { rawTagsOf } from './tagColumnFilter.js';

const NEEDED = [tagKey('Procurement'), tagKey('Decision Maker')];

/** Tagged both Procurement and Decision Maker? */
export function isProcurementDecisionMaker(contact) {
  const have = new Set(rawTagsOf(contact).split(';').map(t => tagKey(t.trim())).filter(Boolean));
  return NEEDED.every(k => have.has(k));
}

/**
 * The contact's own Procurement tag status is Sold or Not sold?
 * `reviewMap` is settings.contactTagReview (contact id -> tag -> record).
 */
export function hasProcurementTagSaleStatus(contact, reviewMap) {
  const cid = contact?.id ?? contact?.vid;
  if (cid == null || !reviewMap) return false;
  const { status } = tagRecordFrom(findTagRecord(reviewMap[cid], 'Procurement'));
  return status === 'sold' || status === 'notsold';
}

/** The button's test for one contact row (its raw HubSpot contact). */
export function isOpenProcurementDecisionMaker(contact, reviewMap) {
  return isProcurementDecisionMaker(contact) && !hasProcurementTagSaleStatus(contact, reviewMap);
}
