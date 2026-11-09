// The "Procurement DMs, open" button on the contacts tables (Key Contacts,
// All Contacts, Clients, Active): contacts tagged both Procurement and
// Decision Maker whose company has not yet answered Procurement, i.e. none
// of its Procurement services is Sold or Not Sold.
//
// "Its Procurement services" are the services whose Contact Tags carry
// Procurement (the service popup's field), the same list the company
// popup's By Category table works Procurement across (utils/bucketServices).
// The status is the one set on the company card's Services board
// (record.servicesExplored). A contact with no matched company has no
// statuses, so nothing has been answered and it stays in.
//
// The contact's own answer counts too: a contact whose Procurement tag
// status (the contact popup's Sold / Not sold, settings.contactTagReview)
// is Sold or Not sold has been answered, so it stays out.
// Pure, so scripts/procurementDmFilter.test.mjs checks it.

import { servicesForBucket } from './bucketServices.js';
import { serviceStatusBucket } from './serviceStatusColors.js';
import { tagKey, findTagRecord, tagRecordFrom } from './contactTagReview.js';
import { rawTagsOf } from './tagColumnFilter.js';

export const PROCUREMENT_BUCKET = { key: 'procurement', label: 'Procurement' };
const NEEDED = [tagKey('Procurement'), tagKey('Decision Maker')];

/** Tagged both Procurement and Decision Maker? */
export function isProcurementDecisionMaker(contact) {
  const have = new Set(rawTagsOf(contact).split(';').map(t => tagKey(t.trim())).filter(Boolean));
  return NEEDED.every(k => have.has(k));
}

/**
 * The company's Procurement services that are Sold or Not Sold, as
 * [{ name, status }]. `ctx` is serviceBucketContext(settings).
 */
export function answeredProcurementServices(prospect, ctx) {
  if (!prospect || !ctx) return [];
  const svc = prospect.servicesExplored || {};
  return servicesForBucket(PROCUREMENT_BUCKET, ctx.names, ctx.overrides)
    .map(name => ({ name, status: String(svc[name] ?? '').trim() }))
    .filter(s => {
      const b = serviceStatusBucket(s.status);
      return b === 'sold' || b === 'notSold';
    });
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

/** The button's test for one contact row (its raw HubSpot contact and matched company). */
export function isOpenProcurementDecisionMaker(contact, prospect, ctx, reviewMap) {
  return isProcurementDecisionMaker(contact)
    && !hasProcurementTagSaleStatus(contact, reviewMap)
    && answeredProcurementServices(prospect, ctx).length === 0;
}
