// The services board layout — which box each service sits in.
//
// One layout, read by every board that groups services: the Opps Scope
// picker, the company card's Services Explored board, the Pipeline coverage
// table, and the Service Bucket column on Dropdowns › Services.
//
// SERVICE_CATEGORIES is the seed. The moment anyone moves a service between
// boxes — dragging it on the company card, or picking a bucket on the
// Services subtab — the whole layout is written to
// settings.customServiceCategories and that copy takes over. That's how the
// board has always worked; the Services subtab is just a second way in.

import { SERVICE_CATEGORIES } from '../data/enums';

// The card the Scope picker adds for services no box claims. Not a real box:
// nothing is stored under it, and choosing it on the Services subtab takes
// the service out of every box rather than filing it into one.
export const UNGROUPED_SERVICES = 'Other services';

// The layout in board order: the user's saved one, or a copy of the seed.
// Always a fresh copy, so a caller can rearrange what it gets back without
// mutating settings.
export function getServiceCategories(settings) {
  const custom = settings?.customServiceCategories;
  const base = (Array.isArray(custom) && custom.length) ? custom : SERVICE_CATEGORIES;
  return base.map(c => ({ name: c.name, items: [...(c.items || [])] }));
}

// Which box a service sits in, or '' when no box claims it — the Scope
// picker files those under UNGROUPED_SERVICES. Matched case-insensitively on
// the whole name, the same test the picker uses to decide what's unfiled, so
// the column and the board can't disagree about where a service lives.
export function serviceBucketOf(categories, name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return '';
  for (const cat of categories || []) {
    if ((cat.items || []).some(i => String(i).trim().toLowerCase() === key)) return cat.name;
  }
  return '';
}

// The layout with `name` moved into `bucket` — or out of every box, when the
// bucket is blank or UNGROUPED_SERVICES. Returns null when the service is
// already there, so callers can skip a no-op write.
//
// The service is pulled from every box before it's filed, so a name that
// somehow ended up in two of them comes out in one.
export function moveServiceToBucket(categories, name, bucket) {
  const target = bucket === UNGROUPED_SERVICES ? '' : String(bucket || '').trim();
  if (serviceBucketOf(categories, name) === target) return null;
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const next = (categories || []).map(c => ({
    name: c.name,
    items: (c.items || []).filter(i => String(i).trim().toLowerCase() !== key),
  }));
  if (target) {
    const box = next.find(c => c.name === target);
    if (box) box.items = [...box.items, name];
    else next.push({ name: target, items: [name] });
  }
  return next;
}
