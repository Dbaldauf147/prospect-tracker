// The services behind each contact category (the BUCKETS the By Category
// ladder is worked across), and whether a company has closed that category
// out by answering every one of them Not Sold or N/A.
//
// A service is tagged to a category through its Contact Tags (the service
// popup's field, settings.serviceOverrides[name].contactTags): the HubSpot
// tags of the people it is sold to. A category whose services are all dead
// at this company has nobody left to find, so its ladder is closed: no
// steps remaining, the Close out step ticked and locked. A category with no
// services tagged to it is never closed this way.
//
// Read in three places, the company popup's By Category table, My Accounts >
// Company Data and its All Missing History, so the rule lives here. Pure,
// pinned by scripts/bucketServices.test.mjs.

import { getEffectiveServiceMetadata, parseServiceContactTags, formatServiceContactTags } from '../data/serviceCatalog.js';
import { getEffectiveDropdownLists } from './dropdownListsStore.js';
import { buildServiceBoard } from './serviceCategoriesStore.js';
import { collectAutoNa, isSoldStatus } from './serviceAutoNa.js';
import { serviceStatusBucket } from './serviceStatusColors.js';
import { tagKey } from './contactTagReview.js';

// Not Sold and N/A are the two answers that say the service isn't on the
// table at this company.
export function isClosingStatus(status) {
  const b = serviceStatusBucket(status);
  return b === 'notSold' || b === 'na';
}

// Does this service carry the category's tag in its Contact Tags?
export function serviceHasBucket(name, bucket, overrides) {
  const k = tagKey(bucket?.label);
  return parseServiceContactTags(getEffectiveServiceMetadata(name, overrides || {}).contactTags)
    .some(t => tagKey(t) === k);
}

// The services tagged to one category, in list order.
export function servicesForBucket(bucket, serviceNames, overrides) {
  return (serviceNames || []).filter(n => serviceHasBucket(n, bucket, overrides));
}

// One category at one company: its services with the company's status for
// each ('' for none), and `closed` when there is at least one and every one
// is Not Sold or N/A. `statusOf(name)` reads the company's status.
export function bucketServiceState({ bucket, serviceNames, overrides, statusOf }) {
  const services = servicesForBucket(bucket, serviceNames, overrides)
    .map(name => ({ name, status: String(statusOf?.(name) || '').trim() }));
  return { services, closed: services.length > 0 && services.every(s => isClosingStatus(s.status)) };
}

export function closedBucketKeys({ buckets, serviceNames, overrides, statusOf }) {
  const out = new Set();
  for (const bucket of buckets || []) {
    if (bucketServiceState({ bucket, serviceNames, overrides, statusOf }).closed) out.add(bucket.key);
  }
  return out;
}

// The overrides with `bucket`'s tag added to (on) or taken off (off) one
// service's Contact Tags. A blank field drops the key, an empty row drops
// the service, the way the service popup saves.
export function setServiceBucket(overrides, name, bucket, on) {
  const current = (overrides && typeof overrides === 'object') ? overrides : {};
  const tags = parseServiceContactTags(getEffectiveServiceMetadata(name, current).contactTags);
  const k = tagKey(bucket.label);
  const has = tags.some(t => tagKey(t) === k);
  if (has === !!on) return current;
  const nextTags = on ? [...tags, bucket.label] : tags.filter(t => tagKey(t) !== k);
  const row = { ...(current[name] || {}) };
  const value = formatServiceContactTags(nextTags);
  // Kept as an explicit '' when a seeded tag is taken off, so the seed
  // doesn't come back through the blank.
  if (value) row.contactTags = value;
  else if (getEffectiveServiceMetadata(name, {}).contactTags) row.contactTags = '';
  else delete row.contactTags;
  const next = { ...current };
  if (Object.keys(row).length === 0) delete next[name]; else next[name] = row;
  return next;
}

// What a company's status reads as away from its popup (Company Data, All
// Missing History): the manual status, else N/A when a sold service rules
// it out (the service's Auto-N/A list). The popup also reads an opp's stage
// for a service with no manual status; these pages have no opps to hand.
// `serviceBucketContext(settings)` once per render, then
// `companyClosedBuckets(record, ctx, buckets)` per company.
export function serviceBucketContext(settings) {
  const solutions = getEffectiveDropdownLists(settings).find(l => l.key === 'solutions')?.options || [];
  const names = [...new Set(buildServiceBoard(settings, solutions).flatMap(c => c.items || []))];
  return {
    names,
    overrides: settings?.serviceOverrides || {},
    byLower: new Map(names.map(n => [n.toLowerCase(), n])),
  };
}

export function companyClosedBuckets(record, ctx, buckets) {
  if (!ctx) return new Set();
  const svc = record?.servicesExplored || {};
  const manual = (n) => { const v = String(svc[n] ?? '').trim(); return v && v !== '-' ? v : ''; };
  const sold = ctx.names.filter(n => isSoldStatus(manual(n)));
  const autoNa = sold.length
    ? collectAutoNa(sold, ctx.overrides, { names: ctx.names, canonical: n => ctx.byLower.get(String(n || '').trim().toLowerCase()) || n })
    : new Map();
  const statusOf = (n) => manual(n) || (autoNa.get(n) ? 'N/A' : '');
  return closedBucketKeys({ buckets, serviceNames: ctx.names, overrides: ctx.overrides, statusOf });
}
