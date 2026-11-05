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
// Pure, so scripts/procurementDmFilter.test.mjs checks it.

import { servicesForBucket } from './bucketServices.js';
import { serviceStatusBucket } from './serviceStatusColors.js';
import { tagKey } from './contactTagReview.js';
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

/** The button's test for one contact row (its raw HubSpot contact and matched company). */
export function isOpenProcurementDecisionMaker(contact, prospect, ctx) {
  return isProcurementDecisionMaker(contact) && answeredProcurementServices(prospect, ctx).length === 0;
}
