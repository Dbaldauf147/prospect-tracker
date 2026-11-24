import assert from 'node:assert/strict';
import { oppsForService, serviceStatusSourceKind } from '../src/utils/serviceStatusSource.js';

const opps = [
  { id: 'a', scope: 'GHG; Budgets', stage: 'Quoting' },
  { id: 'b', scope: 'Comp GHG', stage: 'Sold' },
  { id: 'c', scope: 'Rate optimization', stage: 'Sold' },
  { id: 'd', scope: 'GHG', stage: 'Not Sold' },
];

// The strongest stage feeds the status and comes first; others still listed.
const ghg = oppsForService(opps, 'Comp GHG');
assert.deepEqual(ghg.map(o => o.id), ['b', 'a', 'd']);
assert.deepEqual(ghg.map(o => o.feeds), [true, false, false]);

// Two opps at the winning stage both feed it.
const two = oppsForService([{ id: 'x', scope: 'GHG', stage: 'Quoted' }, { id: 'y', scope: 'GHG', stage: 'Quoted' }], 'Comp GHG');
assert.deepEqual(two.map(o => o.feeds), [true, true]);

// No opp names the service.
assert.deepEqual(oppsForService(opps, 'Strategic sourcing'), []);
assert.deepEqual(oppsForService(null, 'Comp GHG'), []);

assert.equal(serviceStatusSourceKind({ manual: 'Sold', oppStage: 'Quoting' }), 'manual');
assert.equal(serviceStatusSourceKind({ manual: '-', oppStage: 'Quoting' }), 'opp');
assert.equal(serviceStatusSourceKind({ manual: '', autoNa: ['X'] }), 'auto-na');
assert.equal(serviceStatusSourceKind({ categoryNa: { why: 'n' } }), 'category-na');
assert.equal(serviceStatusSourceKind({}), 'none');
console.log('serviceStatusSource ok');
