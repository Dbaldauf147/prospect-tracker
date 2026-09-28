// The Pricing page's Services subtab list.
// Plain Node, no test framework (the project has none). Run:
//   node scripts/pricingServices.test.mjs
//
// What has to hold:
//   1. Every Dropdowns service shows, carrying its status there
//      (retired = graveyard, hidden = hiddenServices).
//   2. Services the SIA's cost lines map to are tagged in scope and sit at
//      the top, whatever their status, matched case-insensitively.
//   3. A service the SIA maps to that the Dropdowns list no longer has
//      still shows, in scope, flagged as not in Dropdowns.
//   4. A service's cost lines are the ones mapped to it, nothing else.

import assert from 'node:assert/strict';
import {
  buildPricingServiceList, costItemsForService, servicesForItems, SERVICE_STATUS,
} from '../src/utils/pricingServices.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const serviceRows = [
  { name: 'Budgets', bucket: 'Data', graveyard: false },
  { name: 'Utility Bill Pay', bucket: 'Payments', graveyard: false },
  { name: 'ENERGY STAR', bucket: 'Reporting', graveyard: false },
  { name: 'Old Thing', bucket: 'Graveyard', graveyard: true },
  { name: 'Quiet One', bucket: 'Data', graveyard: false },
];

test('every service shows with its status', () => {
  const rows = buildPricingServiceList({ serviceRows, hiddenServices: ['Quiet One'] });
  assert.equal(rows.length, 5);
  const by = Object.fromEntries(rows.map(r => [r.name, r.status]));
  assert.equal(by.Budgets, SERVICE_STATUS.ACTIVE);
  assert.equal(by['Old Thing'], SERVICE_STATUS.RETIRED);
  assert.equal(by['Quiet One'], SERVICE_STATUS.HIDDEN);
  assert.ok(rows.every(r => r.inScope === false));
});

test('in-scope services lead, active before inactive, Dropdowns order otherwise', () => {
  const rows = buildPricingServiceList({
    serviceRows,
    hiddenServices: ['Quiet One'],
    scopeServices: ['energy star', 'Old Thing', 'BUDGETS'],
  });
  assert.deepEqual(rows.map(r => r.name), ['Budgets', 'ENERGY STAR', 'Old Thing', 'Utility Bill Pay', 'Quiet One']);
  assert.deepEqual(rows.map(r => r.inScope), [true, true, true, false, false]);
});

test('a mapped service the Dropdowns list lost still shows, in scope', () => {
  const rows = buildPricingServiceList({ serviceRows, scopeServices: ['Renamed Service'] });
  assert.equal(rows[0].name, 'Renamed Service');
  assert.equal(rows[0].inScope, true);
  assert.equal(rows[0].status, SERVICE_STATUS.OFF_LIST);
});

const items = [
  { id: 'a', description: 'Budgets - Commercial Market Intel' },
  { id: 'b', description: 'Direct Bill Payment - Partner Ongoing' },
  { id: 'c', description: 'Building Benchmark Submission' },
];
const lineItemServices = {
  'budgets - commercial market intel': ['Budgets'],
  'direct bill payment - partner ongoing': ['Utility Bill Pay', 'budgets'],
};

test('a service covers exactly the cost lines mapped to it', () => {
  assert.deepEqual(costItemsForService(items, lineItemServices, 'Budgets').map(i => i.id), ['a', 'b']);
  assert.deepEqual(costItemsForService(items, lineItemServices, 'Utility Bill Pay').map(i => i.id), ['b']);
  assert.deepEqual(costItemsForService(items, lineItemServices, 'ENERGY STAR'), []);
});

test('services for the option dedupe case-insensitively', () => {
  assert.deepEqual(servicesForItems(items, lineItemServices), ['Budgets', 'Utility Bill Pay']);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
