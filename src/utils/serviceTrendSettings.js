// Saved By Service trend settings, shared by the By Service trend subtabs
// (components/OppsView2/ServiceTrends.jsx) and the Close Rates tab's
// service chart, so a change made on one shows on the other.
//
//   settings.oppsServiceTrendGroups   { on, groups: [{ name, services }] }
//   settings.oppsServiceTrendExcluded [service]   never its own line; counts in Other
//
// (Visible by default and hidden services live on OppsView2's own keys,
// oppsServiceLinesOffDefault and oppsHiddenServices.) Pure, for tests.

export const GROUPS_KEY = 'oppsServiceTrendGroups';
export const EXCLUDED_KEY = 'oppsServiceTrendExcluded';

export function groupsFromSettings(settings) {
  const g = settings?.[GROUPS_KEY];
  return {
    on: !!g?.on,
    groups: Array.isArray(g?.groups) ? g.groups.filter(x => x && typeof x.name === 'string' && Array.isArray(x.services)) : [],
  };
}

export function excludedFromSettings(settings) {
  return Array.isArray(settings?.[EXCLUDED_KEY]) ? settings[EXCLUDED_KEY] : [];
}

/**
 * Move a service into a group, or out of every group with a blank name.
 * Empty groups drop out. Putting a service in a group switches grouping on
 * so the change shows; taking the last one out switches it off.
 */
export function withServiceGroup(saved, service, groupName) {
  let next = saved.groups.map(g => ({ ...g, services: g.services.filter(x => x !== service) }));
  if (groupName) {
    if (next.some(g => g.name === groupName)) next = next.map(g => (g.name === groupName ? { ...g, services: [...g.services, service] } : g));
    else next = [...next, { name: groupName, services: [service] }];
  }
  next = next.filter(g => g.services.length > 0);
  return { ...saved, groups: next, on: groupName ? true : saved.on && next.length > 0 };
}

/** Add a key to (on) or take it off (off) the Count in Other list, sorted. */
export function withExcluded(excluded, key, on) {
  const rest = (excluded || []).filter(x => x !== key);
  return on ? [...rest, key].sort((a, b) => a.localeCompare(b)) : rest;
}
