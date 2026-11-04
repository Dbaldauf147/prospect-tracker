// Assertion tests for renaming a service group (src/utils/serviceGroupRename.js).
// Plain Node. Run: node scripts/serviceGroupRename.test.mjs
//
// A group is drawn, coloured, switched off and saved in filters under its
// name, so a rename has to carry every one of those to the new name.

import assert from 'node:assert/strict';
import { renameServiceGroupPatch, groupRenameProblem } from '../src/utils/serviceGroupRename.js';

const settings = {
  oppsServiceTrendGroups: { on: true, groups: [{ name: 'Energy', services: ['Bill payment', 'AEM'] }, { name: 'Carbon', services: ['GHG'] }] },
  oppsServiceTrendExcluded: ['Energy', 'Zeta'],
  oppsServiceTrendPicks: ['Carbon', 'Energy'],
  oppsServiceLinesOffDefault: ['Energy'],
  oppsHiddenServices: ['Other thing'],
  closeRatesChartPrefs: {
    labels: true,
    colours: { service: { Energy: '#ff0000', GHG: '#00ff00' }, source: { Energy: '#111111' } },
    lineLabels: { service: { Energy: true } },
    targets: { service: 20 },
  },
  closeRateChartFilters: {
    service: { list: [{ id: 1, name: 'No energy', filters: {}, off: ['Energy', 'AEM'] }, { id: 2, name: 'All', filters: {}, off: [] }], defaultId: 1 },
    source: { list: [{ id: 3, name: 'S', filters: {}, off: ['Energy'] }], defaultId: null },
  },
};

const patch = renameServiceGroupPatch(settings, 'Energy', '  Utilities ');
assert.deepEqual(patch.oppsServiceTrendGroups.groups.map(g => g.name), ['Utilities', 'Carbon']);
assert.equal(patch.oppsServiceTrendGroups.on, true);
assert.deepEqual(patch.oppsServiceTrendGroups.groups[0].services, ['Bill payment', 'AEM']);
assert.deepEqual(patch.oppsServiceTrendExcluded, ['Utilities', 'Zeta']);
assert.deepEqual(patch.oppsServiceTrendPicks, ['Carbon', 'Utilities']); // order kept
assert.deepEqual(patch.oppsServiceLinesOffDefault, ['Utilities']);
assert.equal('oppsHiddenServices' in patch, false); // untouched: not in it
// Only the service chart's colour / label move; other charts and keys stay.
assert.deepEqual(patch.closeRatesChartPrefs.colours, { service: { GHG: '#00ff00', Utilities: '#ff0000' }, source: { Energy: '#111111' } });
assert.deepEqual(patch.closeRatesChartPrefs.lineLabels, { service: { Utilities: true } });
assert.deepEqual(patch.closeRatesChartPrefs.targets, { service: 20 });
assert.equal(patch.closeRatesChartPrefs.labels, true);
// Saved filters on the service chart follow; other charts don't.
assert.deepEqual(patch.closeRateChartFilters.service.list[0].off, ['AEM', 'Utilities']);
assert.equal(patch.closeRateChartFilters.service.defaultId, 1);
assert.deepEqual(patch.closeRateChartFilters.source, settings.closeRateChartFilters.source);

// Nothing to do: no such group, same name, blank, or a clash.
assert.equal(renameServiceGroupPatch(settings, 'Nope', 'X'), null);
assert.equal(renameServiceGroupPatch(settings, 'Energy', 'Energy'), null);
assert.equal(renameServiceGroupPatch(settings, 'Energy', '  '), null);
assert.equal(renameServiceGroupPatch(settings, 'Energy', 'carbon'), null);
assert.equal(groupRenameProblem(settings.oppsServiceTrendGroups.groups, 'Energy', 'CARBON'), 'A group already has that name');
assert.equal(groupRenameProblem(settings.oppsServiceTrendGroups.groups, 'Energy', ''), 'Give the group a name');
assert.equal(groupRenameProblem(settings.oppsServiceTrendGroups.groups, 'Energy', 'energy'), null); // a case change is fine

// A minimal settings object: only the groups change.
const bare = renameServiceGroupPatch({ oppsServiceTrendGroups: { on: false, groups: [{ name: 'A', services: ['x'] }] } }, 'A', 'B');
assert.deepEqual(Object.keys(bare), ['oppsServiceTrendGroups']);
assert.equal(bare.oppsServiceTrendGroups.on, false);

console.log('serviceGroupRename: ok');
