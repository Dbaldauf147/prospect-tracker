// The service catalog as rows, built once from settings.
//
// Three things have to agree about what a service IS: its name (the Solutions
// dropdown list), its metadata (the seed catalog plus the user's overrides —
// recurring or project, contract years), and which box on the services board
// it lives in. The Services subtab assembles those three, the Services Pricing
// subtab prices what it assembles, and now the Clients tab's Deal Sizing
// subtab estimates against the same rows.
//
// Assembling them in three places would let them drift, and a service that is
// "recurring, 3 years" on one page and a project on another would price to two
// different deals. So it is assembled here, from settings alone.

import { getEffectiveDropdownLists } from './dropdownListsStore.js';
import { getEffectiveServiceMetadata } from '../data/serviceCatalog.js';
import { getServiceCategories, serviceBucketOf, UNGROUPED_SERVICES } from './serviceCategoriesStore.js';

/**
 * Every service in the vocabulary, as { name, meta, bucket }.
 *
 * `bucket` is '' when no box on the board claims the service, which is the
 * Scope picker's catch-all card — named rather than left blank so a cell and
 * a search box can read the same.
 */
export function buildServiceRows(settings) {
  const lists = getEffectiveDropdownLists(settings);
  const options = lists.find(l => l.key === 'solutions')?.options || [];
  const overrides = (settings?.serviceOverrides && typeof settings.serviceOverrides === 'object')
    ? settings.serviceOverrides
    : {};
  const categories = getServiceCategories(settings);
  return options.map(name => ({
    name,
    meta: getEffectiveServiceMetadata(name, overrides),
    bucket: serviceBucketOf(categories, name) || UNGROUPED_SERVICES,
  }));
}

/**
 * The same rows minus the ones the user has retired.
 *
 * A hidden service is out of the Scope picker, so it cannot be in a deal and
 * pricing or estimating it is moot.
 */
export function pricedServiceRows(settings) {
  const hidden = new Set(settings?.hiddenServices || []);
  return buildServiceRows(settings).filter(r => !hidden.has(r.name));
}
