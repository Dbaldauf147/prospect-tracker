// Assertion tests for the company popup's one-property-type Equipment
// estimate (portfolioEquipmentEstimate in src/data/propertyTypeEstimates.js).
// Run:
//   node scripts/portfolioEquipmentEstimate.test.mjs
import assert from 'node:assert/strict';
import { portfolioEquipmentEstimate, EQUIPMENT_ESTIMATE_TYPES, EQUIPMENT_ESTIMATES } from '../src/data/propertyTypeEstimates.js';

// Sites x the type's per-site count.
assert.deepEqual(portfolioEquipmentEstimate(126, 'Multifamily Mid-Rise'), { each: 160, total: 20160 });
// The site count can arrive as the string an input hands back.
assert.deepEqual(portfolioEquipmentEstimate('10', 'Office - Mid-Rise'), { each: 40, total: 400 });
// An alias spelling resolves like it does everywhere else.
assert.equal(portfolioEquipmentEstimate(2, 'Data Center').total, 400);
// No sites, or a type that doesn't resolve: no estimate, not a zero.
assert.equal(portfolioEquipmentEstimate(null, 'Data Center'), null);
assert.equal(portfolioEquipmentEstimate('', 'Data Center'), null);
assert.equal(portfolioEquipmentEstimate(0, 'Data Center'), null);
assert.equal(portfolioEquipmentEstimate(5, 'Not A Real Type'), null);
assert.equal(portfolioEquipmentEstimate(5, ''), null);

// The picker offers every type with a building, and not Land or Debt.
assert.equal(EQUIPMENT_ESTIMATE_TYPES.includes('Land'), false);
assert.equal(EQUIPMENT_ESTIMATE_TYPES.includes('Debt'), false);
assert.equal(EQUIPMENT_ESTIMATE_TYPES.length, Object.keys(EQUIPMENT_ESTIMATES).length - 2);

console.log('portfolioEquipmentEstimate: all assertions passed');
