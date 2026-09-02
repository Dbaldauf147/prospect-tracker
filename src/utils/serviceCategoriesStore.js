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

import { SERVICE_CATEGORIES } from '../data/enums.js';

// The card the Scope picker adds for services no box claims. Not a real box:
// nothing is stored under it, and choosing it on the Services subtab takes
// the service out of every box rather than filing it into one.
export const UNGROUPED_SERVICES = 'Other services';

// Services inside a box read alphabetically, by the name on screen — so a
// rename sorts where the user sees it, and a service moved into a box lands
// in order instead of on the end. Numeric so "Cat 9" comes before "Cat 10"
// rather than after "Cat 1 & 2", and case-insensitive so capitalisation
// doesn't split the list in two.
//
// Nothing lets a user order services inside a box by hand, so there's no
// manual arrangement for this to overwrite.
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortServiceNames(items, renames) {
  const label = (i) => String((renames && renames[i]) || i || '');
  return [...(items || [])].sort((a, b) => NAME_COLLATOR.compare(label(a), label(b)));
}

// The layout: boxes in board order — that ordering groups the business, so
// it's left as the user (or the seed) arranged it — each box's services
// alphabetical. Always a fresh copy, so a caller can rearrange what it gets
// back without mutating settings.
export function getServiceCategories(settings) {
  const custom = settings?.customServiceCategories;
  const base = (Array.isArray(custom) && custom.length) ? custom : SERVICE_CATEGORIES;
  const renames = settings?.serviceRenames;
  return base.map(c => ({ name: c.name, items: sortServiceNames(c.items, renames) }));
}

// The board as it should be shown: the user's boxes, plus a trailing
// "Other services" card for anything on the linked list that no box claims.
//
// Every board that offers services to pick from needs that trailing card, or
// a service the user adds on Dropdowns › Services simply vanishes from it
// until somebody remembers to file it into a box. The Opps Scope picker had
// this and the company card's Services Explored board did not, which is
// exactly how a service added on the Dropdowns tab could be listed there,
// pickable in Scope, and nowhere to be found on the company popup.
//
// The trailing card is a view, not a box: nothing is stored under it, and it
// is absent entirely when every service is filed. Callers that let the user
// edit boxes must not write it back into the layout — file a service with
// moveServiceToBucket instead, which knows UNGROUPED_SERVICES means "out of
// every box".
//
// Hidden services are NOT filtered here; hiding is applied by each board on
// the way to the screen, because the company card shows hidden services
// while its Edit Services mode is on.
export function buildServiceBoard(settings, options) {
  const cats = getServiceCategories(settings);
  const filed = new Set(cats.flatMap(c => (c.items || []).map(i => String(i).trim().toLowerCase())));
  const seen = new Set();
  const extra = [];
  for (const o of options || []) {
    const name = String(o || '').trim();
    const key = name.toLowerCase();
    if (!name || filed.has(key) || seen.has(key)) continue;
    seen.add(key);
    extra.push(name);
  }
  if (!extra.length) return cats;
  return [...cats, { name: UNGROUPED_SERVICES, items: sortServiceNames(extra, settings?.serviceRenames) }];
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
// already there, so callers can skip a no-op write. `renames` is
// settings.serviceRenames, so the new name sorts by what's on screen.
//
// The service is pulled from every box before it's filed, so a name that
// somehow ended up in two of them comes out in one.
export function moveServiceToBucket(categories, name, bucket, renames) {
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
    // Sorted on the way in as well as on the way out, so what's stored
    // matches what every board shows rather than trailing the new name.
    if (box) box.items = sortServiceNames([...box.items, name], renames);
    else next.push({ name: target, items: [name] });
  }
  return next;
}

// Every service the board has filed into a box, in board order. The
// Solutions list is unioned with this (see mergeBoardServices in
// dropdownListsStore) so a service can never be pickable in Scope while
// missing from the Dropdowns › Services table.
//
// Hidden services are included: hiding is a separate switch, applied by
// each board on the way to the screen, and the Services subtab has its own
// "Show N hidden" toggle to bring them back. Filtering them out here would
// take a hidden service out of the vocabulary entirely, with no way in.
export function boardServiceNames(settings) {
  return getServiceCategories(settings).flatMap(c => c.items);
}

// The layout with every service not in `keepNames` taken out of its box —
// how a service deleted from the Solutions list leaves the board too.
// Without it the union would file the name straight back and the delete
// would look broken.
//
// Emptied boxes are kept: a box is the user's own arrangement, and the
// boards drop empty ones on the way to the screen anyway, so removing the
// last service out of one shouldn't quietly destroy it.
//
// Returns null when nothing moved, so callers can skip a no-op write.
export function pruneServicesFromCategories(categories, keepNames) {
  const keep = new Set((keepNames || []).map(n => String(n).trim().toLowerCase()));
  let changed = false;
  const next = (categories || []).map(c => {
    const items = (c.items || []).filter(i => keep.has(String(i).trim().toLowerCase()));
    if (items.length !== (c.items || []).length) changed = true;
    return { name: c.name, items };
  });
  return changed ? next : null;
}

// The layout with `from` renamed to `to`, in whatever box it sits in — the
// board half of renaming a service on the Solutions list. The new name is
// the same key Scope values are stored under, so it has to land on the
// board as well; otherwise the old name survives in its box and the union
// brings it back alongside the new one.
//
// Not to be confused with settings.serviceRenames, which is the company
// card's display-only alias and leaves the underlying name alone.
//
// Returns null when no box holds `from`, so callers can skip the write.
export function renameServiceInCategories(categories, from, to) {
  const key = String(from || '').trim().toLowerCase();
  const target = String(to || '').trim();
  if (!key || !target) return null;
  let found = false;
  const next = (categories || []).map(c => {
    if (!(c.items || []).some(i => String(i).trim().toLowerCase() === key)) return c;
    found = true;
    return {
      name: c.name,
      items: sortServiceNames(
        c.items.map(i => (String(i).trim().toLowerCase() === key ? target : i)),
      ),
    };
  });
  return found ? next : null;
}
