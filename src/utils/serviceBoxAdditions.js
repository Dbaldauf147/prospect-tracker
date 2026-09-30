// New boxes the app ships, carried onto a board layout somebody has already
// saved.
//
// Adding a box to SERVICE_CATEGORIES only reaches an account that has never
// moved a service: the moment anyone drags a service or picks a bucket, the
// whole layout is stored in settings.customServiceCategories and the seed is
// never read again (see serviceCategoriesStore.js). So each box added to the
// seed ships with an entry here, and App.jsx runs it once per browser.
//
// The pass is planned as pure data so it can be tested without a Firestore.
// Running it against a layout that already has the box plans to nothing.

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

const norm = s => String(s || '').trim().toLowerCase();

// The seed's own copy of the box: the services it ships holding.
function seedItems(box) {
  return SERVICE_CATEGORIES.find(c => c.name === box)?.items || [];
}

/**
 * What one addition changes, as a settings patch, or null when there is
 * nothing to do: the layout is still the seed (which already has the box),
 * or the stored layout already carries it.
 */
export function planServiceBoxAddition(addition, settings = {}) {
  const stored = settings?.customServiceCategories;
  if (!Array.isArray(stored) || !stored.length) return null;
  if (stored.some(c => norm(c?.name) === norm(addition.box))) return null;

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

  const patch = { customServiceCategories: next };

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
