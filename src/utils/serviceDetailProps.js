// Everything the service popup needs about one service, derived from settings.
//
// ServiceDetailModal has shown a service whole since the Services subtab grew
// twelve columns behind a horizontal scrollbar, but the props behind it were
// assembled inside DropdownsView: which box on the board claims the service,
// which services wait on it, which ones pull it into Scope, which sales mark
// it N/A, the timeline templates. None of that is page state — it is all read
// off settings — so it is derived here instead, and any board that lists
// service names can open the same popup rather than growing a second, thinner
// version of it.
//
// Read-only: nothing here writes. The callers own the save paths, which are
// the same four settings keys the Services subtab writes (serviceOverrides,
// serviceLinks, hiddenServices, customServiceCategories).

import { buildServiceRows } from './serviceRows.js';
import { getEffectiveServiceMetadata } from '../data/serviceCatalog.js';
import {
  getServiceCategories, serviceBucketOf, UNGROUPED_SERVICES,
} from './serviceCategoriesStore.js';
import { autoAddedByMap } from './serviceAutoAdd.js';
import { autoNaedByMap } from './serviceAutoNa.js';
import { getTimelineTemplates } from './timelineTemplatesStore.js';
import { splitServiceNames } from './serviceNameList.js';

function serviceOverridesOf(settings) {
  return (settings?.serviceOverrides && typeof settings.serviceOverrides === 'object')
    ? settings.serviceOverrides
    : {};
}

function serviceLinksOf(settings) {
  return (settings?.serviceLinks && typeof settings.serviceLinks === 'object')
    ? settings.serviceLinks
    : {};
}

/**
 * One service's popup data, or null when no name was asked for.
 *
 * Returns { service, bucket, bucketOptions, options, templates, dependents,
 * autoAddedBy, autoNaedBy, hidden, url }, shaped for ServiceDetailModal's
 * props.
 *
 * A name the vocabulary doesn't carry — a board-only service, or one typed
 * straight into a Scope cell — still opens, with empty fields rather than no
 * popup at all. Filling one in is what starts its override row.
 */
export function buildServiceDetail(settings, name) {
  const wanted = String(name ?? '').trim();
  if (!wanted) return null;

  const rows = buildServiceRows(settings);
  const names = rows.map(r => r.name);
  const overrides = serviceOverridesOf(settings);
  const categories = getServiceCategories(settings);
  const key = wanted.toLowerCase();

  const service = rows.find(r => r.name.trim().toLowerCase() === key) || {
    name: wanted,
    meta: getEffectiveServiceMetadata(wanted, overrides),
    bucket: serviceBucketOf(categories, wanted) || UNGROUPED_SERVICES,
    graveyard: false,
  };

  // The reverse of Dependent Rollout Services: nothing stores it, so it is
  // read off every other row's list. Split against the known names so a
  // service with a comma in its name is one dependency rather than four.
  const dependents = rows
    .filter(r => splitServiceNames(r.meta?.dependsOn || '', names)
      .some(dep => dep.trim().toLowerCase() === key))
    .map(r => r.name);

  const links = serviceLinksOf(settings);

  return {
    service,
    bucket: service.bucket,
    bucketOptions: categories.map(c => c.name),
    options: names,
    templates: getTimelineTemplates(settings),
    dependents,
    // The reverses of Auto-add and Auto-N/A, for the same reason: they are
    // what explain a tick nobody made and an N/A nobody typed.
    autoAddedBy: autoAddedByMap(names, overrides).get(key) || [],
    autoNaedBy: autoNaedByMap(names, overrides).get(key) || [],
    hidden: (settings?.hiddenServices || []).includes(service.name),
    url: links[service.name] || '',
  };
}
