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
import { contactNaByBucket } from './dmSteps.js';

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
// `companyClosedBuckets(record, ctx, buckets, { contacts, tagReview })` per
// company (the contacts are optional: a contact's N/A on a tag closes that
// category too).
export function serviceBucketContext(settings) {
  const solutions = getEffectiveDropdownLists(settings).find(l => l.key === 'solutions')?.options || [];
  const names = [...new Set(buildServiceBoard(settings, solutions).flatMap(c => c.items || []))];
  return {
    names,
    overrides: settings?.serviceOverrides || {},
    byLower: new Map(names.map(n => [n.toLowerCase(), n])),
  };
}

export function companyClosedBuckets(record, ctx, buckets, opts = {}) {
  return new Set(companyClosedBucketReasons(record, ctx, buckets, opts).keys());
}

// What a closed category reads as in a table cell.
export const CLOSED_NA = 'N/A';
export const CLOSED_NOT_SOLD = 'Not Sold';
export const CLOSED_MIXED = 'Not Sold / N/A';

/**
 * The closed categories at a company and why, Map(bucket key -> { label,
 * why }). `label` is N/A when the category is marked N/A (by its heading or
 * by a contact) or every service tagged to it is N/A, Not Sold when every
 * one is Not Sold, and Not Sold / N/A for a mix. `why` is the sentence
 * behind it, for a tooltip. companyClosedBuckets is this map's keys.
 */
export function companyClosedBucketReasons(record, ctx, buckets, { contacts = null, tagReview = null } = {}) {
  const out = new Map();
  // A contact at the company with the category's tag marked N/A closes it
  // too (dmSteps contactNaByBucket); the caller passes the contacts it has.
  const contactNa = contacts && tagReview ? contactNaByBucket(contacts, tagReview, buckets) : new Map();
  let statusOf = null;
  if (ctx) {
    const svc = record?.servicesExplored || {};
    const manual = (n) => { const v = String(svc[n] ?? '').trim(); return v && v !== '-' ? v : ''; };
    const sold = ctx.names.filter(n => isSoldStatus(manual(n)));
    const autoNa = sold.length
      ? collectAutoNa(sold, ctx.overrides, { names: ctx.names, canonical: n => ctx.byLower.get(String(n || '').trim().toLowerCase()) || n })
      : new Map();
    statusOf = (n) => manual(n) || (autoNa.get(n) ? 'N/A' : '');
  }
  for (const bucket of buckets || []) {
    // A category marked N/A by hand on the company card's By Category
    // heading (dmSearchSteps[bucket].na) comes first, then a contact's N/A,
    // then the services: the order the popup's heading explains it in.
    if (record?.dmSearchSteps?.[bucket.key]?.na) {
      out.set(bucket.key, { label: CLOSED_NA, why: `${bucket.label} is marked N/A for this company.` });
      continue;
    }
    const by = (contactNa.get(bucket.key) || []).map(x => x.name);
    if (by.length) {
      out.set(bucket.key, { label: CLOSED_NA, why: `${bucket.label} is marked N/A by ${by.join(', ')}.` });
      continue;
    }
    if (!statusOf) continue;
    const state = bucketServiceState({ bucket, serviceNames: ctx.names, overrides: ctx.overrides, statusOf });
    if (!state.closed) continue;
    const kinds = new Set(state.services.map(sv => serviceStatusBucket(sv.status)));
    out.set(bucket.key, {
      label: kinds.size > 1 ? CLOSED_MIXED : kinds.has('na') ? CLOSED_NA : CLOSED_NOT_SOLD,
      why: `Every ${bucket.label} service is Not Sold or N/A here: ${state.services.map(sv => `${sv.name} (${sv.status})`).join(', ')}.`,
    });
  }
  return out;
}

/**
 * The services that read N/A at a company because their contact category is
 * N/A there: the By Category heading's own N/A (record.dmSearchSteps[key].na)
 * or a contact with that category's tag marked N/A (contactNaByBucket).
 * Returns Map(service name -> { why, bucket }), the first category to claim
 * a service winning. Derived only: callers lay it under a manual status and
 * a matching opp, like the sold-service Auto-N/A.
 */
export function categoryNaServices({ buckets, serviceNames, overrides, dmSearchSteps = null, contacts = null, tagReview = null }) {
  const out = new Map();
  const byContact = contacts && tagReview ? contactNaByBucket(contacts, tagReview, buckets) : new Map();
  for (const b of buckets || []) {
    const names = (byContact.get(b.key) || []).map(x => x.name);
    if (!names.length && !dmSearchSteps?.[b.key]?.na) continue;
    const why = names.length
      ? `${b.label} is marked N/A by ${names.join(', ')}`
      : `${b.label} is marked N/A for this company`;
    for (const name of servicesForBucket(b, serviceNames, overrides || {})) {
      if (!out.has(name)) out.set(name, { why, bucket: b.label });
    }
  }
  return out;
}
