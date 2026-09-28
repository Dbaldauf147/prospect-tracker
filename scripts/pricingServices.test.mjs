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
  feeStructureRowsFromFees, feeStructureRowToAltRow, applyFeeStructureToSchedule,
  addServiceToLineItem, costTotalsByLineItem,
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

// Standard fee structures.
//   5. Seeding from the fees shown keeps typed values and leaves derived
//      ones blank, so they keep deriving.
//   6. A blank unit count derives from the SIA's site / account count.
//   7. Applying swaps out exactly the service's fee rows, in place, and
//      leaves every other fee alone.

test('seeding a structure keeps typed values, leaves derived ones blank', () => {
  const rows = feeStructureRowsFromFees([
    { name: 'Per site', type: 'One Time', feePerUnit: 19.22, feeIsManual: false, unit: 'Per Site', manualStartMonth: null, manualGmPct: null },
    { name: 'Program fee', type: 'Recurring (monthly)', feePerUnit: 500, feeIsManual: true, unit: 'Fixed', manualStartMonth: 3, manualGmPct: 0.4, passThrough: true },
    { name: 'Ghost', missing: true },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fee, null);
  assert.equal(rows[0].unitCount, null);
  assert.deepEqual(rows[1], { feeName: 'Program fee', type: 'Recurring (monthly)', fee: 500, unit: 'Fixed', unitCount: null, startMonth: 3, feeGmPct: 0.4, passThrough: true });
});

test('a blank unit count derives from the SIA counts', () => {
  const counts = { siteCount: 29, accountCount: 519 };
  assert.equal(feeStructureRowToAltRow({ feeName: 'a', unit: 'Per Site' }, counts).unitCount, 29);
  assert.equal(feeStructureRowToAltRow({ feeName: 'a', unit: 'Per Account' }, counts).unitCount, 519);
  assert.equal(feeStructureRowToAltRow({ feeName: 'a', unit: 'Fixed' }, counts).unitCount, 1);
  assert.equal(feeStructureRowToAltRow({ feeName: 'a', unit: 'Per Site', unitCount: 10 }, counts).unitCount, 10);
});

test('applying replaces only the service fee rows, in place', () => {
  const schedule = [
    { altItem: 'Setup', type: 'Setup', fee: 100 },
    { altItem: 'Per site', type: 'One Time', fee: null },
    { altItem: 'Program fee', type: 'Recurring (monthly)', fee: null },
    { altItem: '', type: '', fee: null },
  ];
  const { rows, removed, added } = applyFeeStructureToSchedule(schedule, [
    { feeName: 'Benchmark fee', type: 'Recurring (monthly)', fee: 12, unit: 'Per Site' },
    { feeName: '', type: 'Setup' },
  ], { replaceNames: ['per site'], siteCount: 29 });
  assert.deepEqual(rows.map(r => r.altItem), ['Setup', 'Benchmark fee', 'Program fee', '']);
  assert.equal(rows[1].unitCount, 29);
  assert.equal(removed.length, 1);
  assert.equal(added.length, 1);
});

test('applying with nothing to replace lands above trailing blank rows', () => {
  const { rows } = applyFeeStructureToSchedule(
    [{ altItem: 'Setup', fee: 1 }, { altItem: '', fee: null }, { altItem: '', fee: null }],
    [{ feeName: 'New', type: 'Setup', unit: 'Fixed' }],
  );
  assert.deepEqual(rows.map(r => r.altItem), ['Setup', 'New', '', '']);
});

test('tagging an unlinked line item adds the service once', () => {
  const start = { 'site setup': ['Budgets'] };
  const a = addServiceToLineItem(start, 'Data Mgmt', 'Utility Bill Pay');
  assert.deepEqual(a['data mgmt'], ['Utility Bill Pay']);
  assert.deepEqual(start, { 'site setup': ['Budgets'] });
  const b = addServiceToLineItem(a, 'site setup', 'ENERGY STAR');
  assert.deepEqual(b['site setup'], ['Budgets', 'ENERGY STAR']);
  assert.equal(addServiceToLineItem(b, 'site setup', 'budgets'), b);
  assert.equal(addServiceToLineItem(b, '', 'Budgets'), b);
  assert.equal(addServiceToLineItem(b, 'x', '  '), b);
});

test('cost totals group cost lines by description', () => {
  const t = costTotalsByLineItem([
    { description: 'Setup', cts: 100 }, { description: 'setup ', cts: 50 }, { description: 'Other', cts: null }, { description: '' },
  ]);
  assert.deepEqual(t, { setup: { count: 2, cts: 150 }, other: { count: 1, cts: 0 } });
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
