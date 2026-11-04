// Renaming a service group (Opps > Close Rates, chart 3; the same groups as
// By Service).
//
// A group is drawn, coloured, switched on or off, and hidden under its NAME,
// so a rename that only changed the group list would quietly drop all of
// that: the renamed line would come back in a palette colour, visible, with
// its saved filters pointing at a name that no longer exists. This builds one
// settings patch that moves every one of those over to the new name.
//
// Pure, so scripts/serviceGroupRename.test.mjs can check it.

import { GROUPS_KEY, EXCLUDED_KEY, groupsFromSettings } from './serviceTrendSettings.js';

const CHART_PREFS_KEY = 'closeRatesChartPrefs';
const CHART_FILTERS_KEY = 'closeRateChartFilters';

/**
 * Why `newName` can't replace group `oldName`, or null when it can.
 * Names are compared case-insensitively, as the group editor does.
 */
export function groupRenameProblem(groups, oldName, newName) {
  const name = String(newName || '').trim();
  if (!name) return 'Give the group a name';
  const lower = name.toLowerCase();
  if (groups.some(g => g.name !== oldName && g.name.trim().toLowerCase() === lower)) return 'A group already has that name';
  return null;
}

const swapIn = (list, from, to) => (Array.isArray(list) && list.includes(from)
  ? [...new Set(list.map(x => (x === from ? to : x)))]
  : list);

const swapKey = (map, from, to) => {
  if (!map || typeof map !== 'object' || !(from in map)) return map;
  const { [from]: v, ...rest } = map;
  return { ...rest, [to]: v };
};

/**
 * The settings patch that renames group `oldName` to `newName`, or null when
 * there is nothing to rename (no such group, an invalid name, or the same
 * name). Only keys that actually change are in the patch.
 */
export function renameServiceGroupPatch(settings, oldName, newName) {
  const name = String(newName || '').trim();
  const saved = groupsFromSettings(settings);
  if (!saved.groups.some(g => g.name === oldName)) return null;
  if (name === oldName || groupRenameProblem(saved.groups, oldName, name)) return null;

  const patch = {
    [GROUPS_KEY]: { ...settings[GROUPS_KEY], ...saved, groups: saved.groups.map(g => (g.name === oldName ? { ...g, name } : g)) },
  };
  const lists = [EXCLUDED_KEY, 'oppsServiceTrendPicks', 'oppsServiceLinesOffDefault', 'oppsHiddenServices'];
  for (const key of lists) {
    const before = settings?.[key];
    const after = swapIn(before, oldName, name);
    if (after !== before) patch[key] = key === 'oppsServiceTrendPicks' ? after : [...after].sort((a, b) => a.localeCompare(b));
  }

  // The Close Rates chart's colour and data-label choice for the line.
  const prefs = settings?.[CHART_PREFS_KEY];
  if (prefs && typeof prefs === 'object') {
    const colours = prefs.colours?.service;
    const labels = prefs.lineLabels?.service;
    const nextColours = swapKey(colours, oldName, name);
    const nextLabels = swapKey(labels, oldName, name);
    if (nextColours !== colours || nextLabels !== labels) {
      patch[CHART_PREFS_KEY] = {
        ...prefs,
        ...(nextColours !== colours ? { colours: { ...prefs.colours, service: nextColours } } : {}),
        ...(nextLabels !== labels ? { lineLabels: { ...prefs.lineLabels, service: nextLabels } } : {}),
      };
    }
  }

  // Saved filters on the service chart that switch the line off.
  const chartFilters = settings?.[CHART_FILTERS_KEY];
  const svc = chartFilters?.service;
  if (svc && Array.isArray(svc.list) && svc.list.some(e => Array.isArray(e?.off) && e.off.includes(oldName))) {
    patch[CHART_FILTERS_KEY] = {
      ...chartFilters,
      service: {
        ...svc,
        list: svc.list.map(e => (Array.isArray(e?.off) && e.off.includes(oldName)
          ? { ...e, off: [...new Set(e.off.map(x => (x === oldName ? name : x)))].sort() }
          : e)),
      },
    };
  }
  return patch;
}
