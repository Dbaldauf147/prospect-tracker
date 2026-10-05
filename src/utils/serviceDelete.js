// Deleting a service from its popup (ServiceDetailModal's "Delete service").
//
// The same edit the Lists tab makes when a name is x'd off the Solutions
// list: the list is written back without it, and the name leaves its box on
// the services board too, since the list is served as the union of the two
// (mergeBoardServices) and would otherwise file it straight back.
//
// Only the list and the board are touched. The service's details (notes,
// link, pricing, timeline) stay stored under its name, so adding it back
// brings them with it, and opps whose Scope names it keep the name (they
// show on Issues as "Service not in Dropdowns").
import { getEffectiveDropdownLists } from './dropdownListsStore.js';
import { getServiceCategories, pruneServicesFromCategories } from './serviceCategoriesStore.js';

// The settings patch that deletes `name`, or null when there is nothing to
// delete (no name, the Solutions list hidden, or the name not on it).
export function deleteServiceUpdates(settings, name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return null;
  const list = getEffectiveDropdownLists(settings).find(l => l.key === 'solutions');
  if (!list) return null;
  const options = list.options.filter(o => String(o ?? '').trim().toLowerCase() !== key);
  if (options.length === list.options.length) return null;
  const updates = { dropdownLists: { ...(settings?.dropdownLists || {}), solutions: options } };
  const pruned = pruneServicesFromCategories(getServiceCategories(settings), options);
  if (pruned) updates.customServiceCategories = pruned;
  const hidden = Array.isArray(settings?.hiddenServices) ? settings.hiddenServices : null;
  if (hidden && hidden.some(h => String(h ?? '').trim().toLowerCase() === key)) {
    updates.hiddenServices = hidden.filter(h => String(h ?? '').trim().toLowerCase() !== key);
  }
  return updates;
}
