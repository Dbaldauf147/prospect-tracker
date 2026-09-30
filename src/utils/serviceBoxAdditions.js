// New boxes the app ships, carried onto a board layout somebody has already
// saved.
//
// Adding a box to SERVICE_CATEGORIES only reaches an account that has never
// moved a service: the moment anyone drags a service or picks a bucket, the
// whole layout is stored in settings.customServiceCategories and the seed is
// never read again (see serviceCategoriesStore.js). So each box added to the
// seed ships with an entry here, and App.jsx plans it whenever settings
// change.
//
// Done is recorded in settings (SERVICE_BOX_ADDITIONS_KEY), not per browser,
// and only once the stored layout actually carries the box. A per-browser
// flag set on load was marked done by an early, empty settings snapshot and
// then never looked again when the real layout arrived. Recorded in
// settings, a bucket the user later deletes stays deleted.
//
// The pass is planned as pure data so it can be tested without a Firestore.

import { SERVICE_CATEGORIES } from '../data/enums.js';

export const SERVICE_BOX_ADDITIONS = [
  // Communication Services was one service inside Consulting Services; it is
  // now a box of its own holding the services it is actually sold as. The
  // old single service is retired from the board and the Solutions list so
  // it doesn't sit beside the box as an "Other services" card. Statuses
  // recorded against it on a company stay where they are.
  {
    flag: 'service-box-communication-services-2026-09',
    box: 'Communication Services',
    after: 'Consulting Services',
    retire: ['Communication Services'],
  },
];

export const SERVICE_BOX_ADDITIONS_KEY = 'serviceBoxAdditionsDone';

const norm = s => String(s || '').trim().toLowerCase();

// The seed's own copy of the box: the services it ships holding.
function seedItems(box) {
  return SERVICE_CATEGORIES.find(c => c.name === box)?.items || [];
}

/**
 * What one addition changes, as a settings patch, or null when there is
 * nothing to do: it is already recorded done, or the layout is still the
 * seed (which already has the box, and must not be recorded done: the real
 * layout may simply not have loaded yet). A stored layout that already
 * carries the box only gets the done mark.
 */
export function planServiceBoxAddition(addition, settings = {}) {
  const done = Array.isArray(settings?.[SERVICE_BOX_ADDITIONS_KEY]) ? settings[SERVICE_BOX_ADDITIONS_KEY] : [];
  if (done.includes(addition.flag)) return null;
  const stored = settings?.customServiceCategories;
  if (!Array.isArray(stored) || !stored.length) return null;
  const mark = { [SERVICE_BOX_ADDITIONS_KEY]: [...done, addition.flag] };
  if (stored.some(c => norm(c?.name) === norm(addition.box))) return mark;

  const items = seedItems(addition.box);
  const take = new Set([...items, ...(addition.retire || [])].map(norm));
  // Pulled out of whichever box has them now, so a service somebody filed
  // elsewhere ends up in the new box once rather than in two.
  const next = stored.map(c => ({
    ...c,
    items: (c?.items || []).filter(i => !take.has(norm(i))),
  }));
  const at = next.findIndex(c => c.name === addition.after);
  next.splice(at === -1 ? next.length : at + 1, 0, { name: addition.box, items: [...items] });

  const patch = { customServiceCategories: next, ...mark };

  const retire = new Set((addition.retire || []).map(norm));
  const solutions = settings?.dropdownLists?.solutions;
  if (retire.size && Array.isArray(solutions) && solutions.some(s => retire.has(norm(s)))) {
    patch.dropdownLists = {
      ...settings.dropdownLists,
      solutions: solutions.filter(s => !retire.has(norm(s))),
    };
  }
  return patch;
}
