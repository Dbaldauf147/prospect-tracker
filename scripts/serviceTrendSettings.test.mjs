// Shared By Service trend settings: groups and Count in Other.
import assert from 'node:assert/strict';
import { groupsFromSettings, excludedFromSettings, withServiceGroup, withExcluded } from '../src/utils/serviceTrendSettings.js';

assert.deepEqual(groupsFromSettings({}), { on: false, groups: [] });
assert.deepEqual(groupsFromSettings({ oppsServiceTrendGroups: { on: true, groups: [{ name: 'A', services: ['x'] }, { bad: 1 }] } }), { on: true, groups: [{ name: 'A', services: ['x'] }] });
assert.deepEqual(excludedFromSettings({ oppsServiceTrendExcluded: 'no' }), []);

let g = { on: false, groups: [] };
g = withServiceGroup(g, 'Audits', 'Reporting');
assert.deepEqual(g, { on: true, groups: [{ name: 'Reporting', services: ['Audits'] }] }, 'a new group switches grouping on');
g = withServiceGroup(g, 'ECH', 'Reporting');
assert.deepEqual(g.groups[0].services, ['Audits', 'ECH']);
g = withServiceGroup(g, 'Audits', 'Other group');
assert.deepEqual(g.groups.map(x => [x.name, x.services]), [['Reporting', ['ECH']], ['Other group', ['Audits']]], 'a service is in one group at a time');
g = withServiceGroup(withServiceGroup(g, 'ECH', null), 'Audits', null);
assert.deepEqual(g, { on: false, groups: [] }, 'emptied groups drop out and grouping switches off');

assert.deepEqual(withExcluded(['b'], 'a', true), ['a', 'b']);
assert.deepEqual(withExcluded(['a', 'b'], 'a', false), ['b']);
assert.deepEqual(withExcluded(['a'], 'a', true), ['a'], 'no duplicates');
console.log('PASS serviceTrendSettings');
