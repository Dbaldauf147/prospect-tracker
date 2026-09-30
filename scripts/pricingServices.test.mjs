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
  standardFeesForStructure, costKey, costsByKind, costKindOf,
  addServiceToLineItem, moveLineItemService, moveCostLineService, servicesForCostLine, costTotalsByLineItem, addLaterCostFees,
  costTypeConversion, moveCostAllocation, buildScheduleFromStructures, standardFeeContext, groupFeeRows, effectiveLineItemServices,
  passThroughFeeRows, addPassThroughFees, sharedLineItemsToSplit, setCostLineService, sharedSignature,
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
  assert.deepEqual(rows[1], { feeName: 'Program fee', type: 'Recurring (monthly)', fee: 500, unit: 'Fixed', unitCount: null, startMonth: 3, passThrough: true });
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

// The standard fee behind each structure row.
//   8. A cost lands on the row carrying its fee name unless pointed elsewhere.
//   9. An upfront cost on a monthly fee is flagged until rolled over the
//      term, and once rolled it adds price / months billed / units a month.
//  10. Pointing a cost at "not covered" takes it out.

const bbsCosts = [
  { key: costKey('Building Benchmark Submission', 'One Time'), description: 'Building Benchmark Submission', type: 'One Time', price: 536, feeNames: ['Per site'] },
  { key: costKey('BBS Monthly', 'Recurring (monthly)'), description: 'BBS Monthly', type: 'Recurring (monthly)', price: 290, feeNames: ['Program fee'] },
];

test('costs land on the row carrying their fee name by default', () => {
  const rows = [
    { feeName: 'Per site', type: 'One Time', unit: 'Per Site' },
    { feeName: 'Program fee', type: 'Recurring (monthly)', unit: 'Fixed' },
  ];
  const { perRow, costs } = standardFeesForStructure({ rows, costs: bbsCosts, termMonths: 36, siteCount: 29 });
  assert.deepEqual(costs.map(c => c.rowIdx), [0, 1]);
  assert.equal(perRow[0].standardFee, 18.48); // 536 / 29
  assert.equal(perRow[1].standardFee, 290);
});

test('an upfront cost on a monthly fee is flagged until rolled, then spread over the term', () => {
  const rows = [{ feeName: 'BBS per site', type: 'Recurring (monthly)', unit: 'Per Site' }];
  const allocations = { [bbsCosts[0].key]: { fee: 'bbs per site' } };
  let r = standardFeesForStructure({ rows, costs: bbsCosts.slice(0, 1), allocations, termMonths: 36, siteCount: 29 });
  assert.equal(r.costs[0].issue, 'upfrontOnRecurring');
  assert.equal(r.costs[0].canRoll, true);
  assert.equal(r.perRow[0].standardFee, null);
  r = standardFeesForStructure({ rows, costs: bbsCosts.slice(0, 1), allocations: { [bbsCosts[0].key]: { fee: 'bbs per site', roll: true } }, termMonths: 36, siteCount: 29 });
  assert.equal(r.costs[0].issue, '');
  assert.equal(r.perRow[0].standardFee, 0.51); // 536 / 36 / 29
  // Starting in month 13 leaves 24 months to recover it in.
  r = standardFeesForStructure({ rows: [{ ...rows[0], startMonth: 13 }], costs: bbsCosts.slice(0, 1), allocations: { [bbsCosts[0].key]: { fee: 'bbs per site', roll: true } }, termMonths: 36, siteCount: 29 });
  assert.equal(r.perRow[0].standardFee, 0.77); // 536 / 24 / 29
});

test('a monthly fee starting after its monthly cost catches up the months it missed', () => {
  const cost = { key: costKey('Data', 'Recurring (monthly)'), description: 'Data', type: 'Recurring (monthly)', price: 100, startMonth: 1, feeNames: ['Per account monthly'] };
  const row = { feeName: 'Per account monthly', type: 'Recurring (monthly)', unit: 'Per Account' };
  // Both from month 1: the monthly price per account.
  let r = standardFeesForStructure({ rows: [row], costs: [cost], termMonths: 36, accountCount: 10 });
  assert.equal(r.perRow[0].standardFee, 10);
  assert.equal(r.costs[0].catchUpMonths, 0);
  // Fee from month 4: 36 months of cost billed over 33.
  r = standardFeesForStructure({ rows: [{ ...row, startMonth: 4 }], costs: [cost], termMonths: 36, accountCount: 10 });
  assert.equal(r.perRow[0].standardFee, Math.round(100 * 36 / 33 / 10 * 100) / 100);
  assert.equal(r.costs[0].catchUpMonths, 3);
  assert.ok(Math.abs(r.perRow[0].exactFee * 10 * 33 - 100 * 36) < 1e-9);
  // A blank Start Month reads the schedule's auto start month.
  r = standardFeesForStructure({ rows: [row], costs: [cost], termMonths: 36, accountCount: 10, startMonthFor: (alt) => (alt.altItem === 'Per account monthly' ? 4 : null) });
  assert.equal(r.perRow[0].startMonth, 4);
  assert.equal(r.perRow[0].standardFee, Math.round(100 * 36 / 33 / 10 * 100) / 100);
  // A cost starting with (or after) the fee is not raised.
  r = standardFeesForStructure({ rows: [{ ...row, startMonth: 4 }], costs: [{ ...cost, startMonth: 4 }], termMonths: 36, accountCount: 10 });
  assert.equal(r.perRow[0].standardFee, 10);
  // A Linked To start month of 4 on a cost that really runs from month 1
  // moves only the fee: the cost still bills months 1 to 3, so the fee
  // still catches them up (billStartMonth is when the cost starts).
  r = standardFeesForStructure({ rows: [row], costs: [{ ...cost, startMonth: 4, billStartMonth: 1 }], termMonths: 36, accountCount: 10, startMonthFor: () => 4 });
  assert.equal(r.perRow[0].standardFee, Math.round(100 * 36 / 33 / 10 * 100) / 100);
  assert.equal(r.costs[0].catchUpMonths, 3);
  assert.equal(r.costs[0].startMonth, 4, 'the allocation key and later-cost checks still read the default');
  const ctx = standardFeeContext({ rows: [row] }, [{ description: 'Data', type: 'Recurring (monthly)', price: 100, startMonth: 4, billStartMonth: 1, feeName: 'Per account monthly' }], { termMonths: 36, accountCount: 10, startMonthFor: () => 4 });
  assert.equal(ctx.filled.rows[0].fee, Math.round(100 * 36 / 33 / 10 * 100) / 100);
  // Rolled costs spread over the months the auto start leaves.
  r = standardFeesForStructure({ rows: [row], costs: [{ ...cost, type: 'Setup Rolled', price: 3300 }], termMonths: 36, accountCount: 10, startMonthFor: () => 4 });
  assert.equal(r.perRow[0].standardFee, 10); // 3300 / 33 / 10
});

test('a monthly fee allows for the fee and cost escalators, so the term lands on the target margin', () => {
  const cost = { key: costKey('Data', 'Recurring (monthly)'), description: 'Data', type: 'Recurring (monthly)', price: 100, startMonth: 1, feeNames: ['Fee'] };
  const row = { feeName: 'Fee', type: 'Recurring (monthly)', unit: 'Fixed' };
  const esc = { feeEscalator: 0.05, costEscalator: 0.0385 };
  // Term price of the cost: 100 a month, rising 3.85% a year.
  const costTerm = (from) => { let t = 0; for (let m = from; m <= 36; m++) t += 100 * Math.pow(1.0385, Math.ceil(m / 12) - 1); return t; };
  const feeTerm = (fee, from) => { let t = 0; for (let m = from; m <= 36; m++) t += fee * Math.pow(1.05, Math.ceil(m / 12) - 1); return t; };
  let r = standardFeesForStructure({ rows: [row], costs: [cost], termMonths: 36, ...esc });
  assert.ok(Math.abs(feeTerm(r.perRow[0].exactFee, 1) - costTerm(1)) < 1e-6);
  assert.ok(r.perRow[0].standardFee < 100);
  // Starting in month 4, it still recovers the cost's 36 months.
  r = standardFeesForStructure({ rows: [{ ...row, startMonth: 4 }], costs: [cost], termMonths: 36, ...esc });
  assert.ok(Math.abs(feeTerm(r.perRow[0].exactFee, 4) - costTerm(1)) < 1e-6);
  // Equal escalators leave the monthly price as it is.
  r = standardFeesForStructure({ rows: [row], costs: [cost], termMonths: 36, feeEscalator: 0.04, costEscalator: 0.04 });
  assert.equal(r.perRow[0].standardFee, 100);
  // A rolled cost is spread so the escalating fee bills exactly it.
  r = standardFeesForStructure({ rows: [row], costs: [{ ...cost, type: 'Setup Rolled', price: 3600 }], termMonths: 36, ...esc });
  assert.ok(Math.abs(feeTerm(r.perRow[0].exactFee, 1) - 3600) < 1e-6);
});

test('rolled and monthly costs add together on one monthly fee', () => {
  const rows = [{ feeName: 'All in', type: 'Recurring (monthly)', unit: 'Fixed' }];
  const allocations = { [bbsCosts[0].key]: { fee: 'all in', roll: true }, [bbsCosts[1].key]: { fee: 'All in' } };
  const r = standardFeesForStructure({ rows, costs: bbsCosts, allocations, termMonths: 36 });
  assert.equal(r.perRow[0].standardFee, Math.round((290 + 536 / 36) * 100) / 100);
});

test('a structure carries no margin of its own: an old saved markup or fee GM% is ignored', () => {
  const costs = [
    { ...bbsCosts[0], cost: 400 },
    { ...bbsCosts[1], cost: 200 },
  ];
  const rows = [
    { feeName: 'Per site', type: 'One Time', unit: 'Per Site', markupPct: 0.25, feeGmPct: 0.3 },
    { feeName: 'Program fee', type: 'Recurring (monthly)', unit: 'Fixed', markupPct: 0.5, feeGmPct: 0.3 },
  ];
  const r = standardFeesForStructure({ rows, costs, termMonths: 36, siteCount: 29 });
  // Priced from the costs' marked-up (Global GM%) price, not cost x (1 + markup).
  assert.equal(r.perRow[0].standardFee, Math.round((536 / 29) * 100) / 100);
  assert.equal(r.perRow[1].standardFee, 290);
  assert.equal(feeStructureRowToAltRow(rows[1]).feeGmPct, null);
  const ctx = standardFeeContext({ rows: [rows[1]] }, [{ description: 'BBS Monthly', type: 'Recurring (monthly)', price: 290, cost: 200, startMonth: 1, feeName: 'Program fee' }]);
  assert.equal(ctx.filled.rows[0].fee, 290);
});

test('a monthly cost on an upfront fee is flagged, and "not covered" takes a cost out', () => {
  const rows = [{ feeName: 'Per site', type: 'One Time', unit: 'Fixed' }];
  const r = standardFeesForStructure({ rows, costs: bbsCosts, allocations: { [bbsCosts[1].key]: { fee: 'per site' } } });
  assert.equal(r.costs[1].issue, 'recurringOnUpfront');
  assert.equal(r.perRow[0].standardFee, 536);
  const r2 = standardFeesForStructure({ rows, costs: bbsCosts, allocations: { [bbsCosts[0].key]: { fee: '' } } });
  assert.equal(r2.costs[0].rowIdx, -1);
  assert.equal(r2.perRow[0].standardFee, null);
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

test('moving a cost line swaps one service for another', () => {
  const start = { 'site setup': ['Budgets', 'ENERGY STAR'], other: ['Budgets'] };
  const a = moveLineItemService(start, 'Site Setup', 'budgets', 'Utility Bill Pay');
  assert.deepEqual(a['site setup'], ['Utility Bill Pay', 'ENERGY STAR']);
  assert.deepEqual(a.other, ['Budgets']);
  assert.deepEqual(start['site setup'], ['Budgets', 'ENERGY STAR']);
  // Already on the target: the old pick just drops.
  assert.deepEqual(moveLineItemService(start, 'site setup', 'Budgets', 'energy star')['site setup'], ['ENERGY STAR']);
  // Nothing to move from, or nowhere to go.
  assert.equal(moveLineItemService(start, 'other', 'ENERGY STAR', 'Budgets'), start);
  assert.equal(moveLineItemService(start, 'other', 'Budgets', 'budgets'), start);
  assert.equal(moveLineItemService(start, 'other', 'Budgets', ''), start);
  assert.equal(moveLineItemService(start, 'missing', 'Budgets', 'X'), start);
});

test('moving one cost line leaves the other lines of its line item where they were', () => {
  const start = { 'nam': ['GHG'] };
  const setup = { description: 'NAM', type: 'Setup' };
  const monthly = { description: 'nam', type: 'Recurring (monthly)' };
  const a = moveCostLineService(start, setup, 'ghg', 'Utility feeds');
  assert.deepEqual(a.nam, ['GHG']);
  assert.deepEqual(servicesForCostLine(a, setup), ['Utility feeds']);
  assert.deepEqual(servicesForCostLine(a, monthly), ['GHG']);
  assert.deepEqual(costItemsForService([setup, monthly], a, 'GHG'), [monthly]);
  assert.deepEqual(costItemsForService([setup, monthly], a, 'Utility feeds'), [setup]);
  assert.deepEqual(servicesForItems([setup, monthly], a), ['Utility feeds', 'GHG']);
  // Moving it back drops the line's own pick rather than keeping a copy.
  assert.deepEqual(moveCostLineService(a, setup, 'Utility feeds', 'GHG'), start);
  // Not on the service it's moving from, or nowhere to go: unchanged.
  assert.equal(moveCostLineService(a, monthly, 'Utility feeds', 'X'), a);
  assert.equal(moveCostLineService(a, monthly, 'GHG', 'ghg'), a);
  // A priority line item's other lines still anchor through a moved line.
  const eff = effectiveLineItemServices([setup, { description: 'Pay', type: 'Setup' }],
    { ...a, pay: ['Budgets', 'Utility feeds'] }, { pay: true });
  assert.deepEqual(eff.pay, ['Utility feeds']);
});

test('cost totals group cost lines by description', () => {
  const t = costTotalsByLineItem([
    { description: 'Setup', cts: 100 }, { description: 'setup ', cts: 50 }, { description: 'Other', cts: null }, { description: '' },
  ]);
  assert.deepEqual(t, { setup: { count: 2, cts: 150 }, other: { count: 1, cts: 0 } });
});

// The BPS case: the same line item and type once in month 1 and again in
// month 13.
const bpsCosts = [
  { key: costKey('BPS', 'One Time', 1), description: 'BPS', type: 'One Time', price: 1000, startMonth: 1, feeNames: [] },
  { key: costKey('BPS', 'One Time', 13), description: 'BPS', type: 'One Time', price: 600, startMonth: 13, feeNames: [] },
];
const bpsStructure = {
  rows: [{ feeName: 'BPS per site (year 1)', type: 'One Time', unit: 'Per Site', unitCount: null, startMonth: 1 }],
  allocations: { [costKey('BPS', 'One Time', 1)]: { fee: 'bps per site (year 1)' }, [costKey('BPS', 'One Time', 13)]: { fee: 'bps per site (year 1)' } },
};

test('a cost after month 12 gets its own key; year-1 keys are unchanged', () => {
  assert.equal(costKey('BPS', 'One Time', 1), 'bps::one time');
  assert.equal(costKey('BPS', 'One Time'), 'bps::one time');
  assert.equal(costKey('BPS', 'One Time', 12), 'bps::one time');
  assert.equal(costKey('BPS', 'One Time', 13), 'bps::one time::m13');
});

test('a later cost on a fee billing from month 1 is flagged as billed early', () => {
  const { costs } = standardFeesForStructure({ ...bpsStructure, costs: bpsCosts, siteCount: 10 });
  assert.equal(costs[0].billedEarly, false);
  assert.equal(costs[1].later, true);
  assert.equal(costs[1].billedEarly, true);
});

test('adding later-cost fees splits the month-13 cost onto its own row', () => {
  const next = addLaterCostFees(bpsStructure, bpsCosts, { siteCount: 10 });
  assert.equal(next.rows.length, 2);
  const added = next.rows[1];
  assert.equal(added.feeName, 'BPS per site (year 2)');
  assert.equal(added.type, 'One Time');
  assert.equal(added.unit, 'Per Site');
  assert.equal(added.startMonth, 13);
  const { perRow, costs } = standardFeesForStructure({ ...next, costs: bpsCosts, siteCount: 10 });
  assert.equal(perRow[0].standardFee, 100);
  assert.equal(perRow[1].standardFee, 60);
  assert.ok(costs.every(c => !c.billedEarly));
  assert.equal(addLaterCostFees(next, bpsCosts, { siteCount: 10 }), next);
});

test('an uncovered later cost borrows the fee its year-1 twin is on', () => {
  const st = { rows: bpsStructure.rows, allocations: { [costKey('BPS', 'One Time', 1)]: { fee: 'bps per site (year 1)' } } };
  const next = addLaterCostFees(st, bpsCosts, { siteCount: 10 });
  assert.equal(next.rows[1].feeName, 'BPS per site (year 2)');
  assert.equal(next.rows[1].unit, 'Per Site');
});

test('later monthly and uncovered costs get rows too, one per start month and kind', () => {
  const costs = [
    { key: costKey('Feed', 'Recurring (monthly)', 25), description: 'Feed', type: 'Recurring (monthly)', price: 50, startMonth: 25, feeNames: [] },
    { key: costKey('Audit', 'Setup', 13), description: 'Audit', type: 'Setup', price: 300, startMonth: 13, feeNames: [] },
    { key: costKey('Base', 'Setup', 1), description: 'Base', type: 'Setup', price: 1, startMonth: 1, feeNames: [] },
  ];
  const next = addLaterCostFees({ rows: [], allocations: {} }, costs);
  assert.deepEqual(next.rows.map(r => [r.feeName, r.type, r.startMonth]), [
    ['Feed (year 3)', 'Recurring (monthly)', 25],
    ['Audit (year 2)', 'One Time', 13],
  ]);
});

test('a one-time or setup cost on a monthly standard fee converts to its Rolled variant', () => {
  assert.deepEqual(costTypeConversion('One Time', 'Recurring (monthly)'), { convertTo: 'One Time Rolled', feeBucket: 'recurring' });
  assert.deepEqual(costTypeConversion('Setup', 'Recurring (monthly)'), { convertTo: 'Setup Rolled', feeBucket: 'recurring' });
  assert.deepEqual(costTypeConversion('One Time Rolled', 'One Time'), { convertTo: 'One Time', feeBucket: 'upfront' });
  assert.deepEqual(costTypeConversion('Recurring (monthly)', 'Setup'), { convertTo: null, feeBucket: 'upfront' });
  assert.equal(costTypeConversion('One Time Rolled', 'Recurring (monthly)'), null);
  assert.equal(costTypeConversion('One Time', 'Setup'), null);
  assert.equal(costTypeConversion('Recurring (monthly)', 'Recurring (monthly)'), null);
  assert.equal(costTypeConversion('One Time', ''), null);
});

test('a converted cost keeps the fee it was pointed at', () => {
  const from = costKey('Audit', 'One Time', 1);
  const to = costKey('Audit', 'One Time Rolled', 1);
  const out = moveCostAllocation([
    { id: 'a', allocations: { [from]: { fee: 'program fee', roll: true }, other: { fee: 'x' } } },
    { id: 'b', rows: [] },
  ], from, to);
  assert.deepEqual(out[0].allocations, { other: { fee: 'x' }, [to]: { fee: 'program fee' } });
  assert.deepEqual(out[1], { id: 'b', rows: [] });
});

test('Fee Builder writes every picked structure, keeping untouched rows and earlier picks', () => {
  const schedule = [
    { altItem: 'Old BBS fee', fee: 10, unit: 'Fixed', unitCount: 1 },
    { altItem: 'Bill pay', fee: 5, unit: 'Fixed', unitCount: 1 },
    { altItem: 'Unrelated', fee: 7, unit: 'Fixed', unitCount: 1 },
  ];
  const { rows, perService, shared } = buildScheduleFromStructures(schedule, [
    { service: 'BBS', structureName: 'Per site', rows: [{ feeName: 'BBS per site', type: 'Recurring (monthly)', fee: 46.45, unit: 'Per Site' }], replaceNames: ['Old BBS fee'] },
    // Bill payment's current fee names include the one BBS just wrote; it must survive.
    { service: 'Bill payment', structureName: 'Flat', rows: [{ feeName: 'Bill pay flat', type: 'Setup', fee: 100, unit: 'Fixed' }], replaceNames: ['Bill pay', 'BBS per site'] },
  ], { siteCount: 29 });
  assert.deepEqual(rows.map(r => r.altItem), ['BBS per site', 'Bill pay flat', 'Unrelated']);
  assert.equal(rows[0].unitCount, 29);
  assert.deepEqual(perService.map(p => p.removed.map(r => r.altItem)), [['Old BBS fee'], ['Bill pay']]);
  assert.deepEqual(shared, []);
});

test('structuresOnly: only fees a picked structure writes stay on the schedule', () => {
  const schedule = [
    { altItem: 'Old BBS fee', fee: 10, unit: 'Fixed', unitCount: 1 },
    { altItem: 'Bill pay monthly - SE', fee: 1.68, unit: 'Per Account', unitCount: 519 },
    { altItem: '', fee: null },
  ];
  const { rows, dropped, perService } = buildScheduleFromStructures(schedule, [
    { service: 'BBS', structureName: 'Per site', rows: [{ feeName: 'BBS per site', type: 'Recurring (monthly)', fee: 46.45, unit: 'Per Site' }], replaceNames: ['Old BBS fee'] },
  ], { siteCount: 29, structuresOnly: true });
  assert.deepEqual(rows.map(r => r.altItem), ['BBS per site', '']);
  assert.deepEqual(dropped.map(r => r.altItem), ['Bill pay monthly - SE']);
  assert.deepEqual(perService[0].removed.map(r => r.altItem), ['Old BBS fee']);
  // Without it the untouched row stays, as before.
  assert.deepEqual(buildScheduleFromStructures(schedule, [], {}).dropped, []);
});

test('Fee Builder keeps a row per service for a shared fee name, grouped together', () => {
  const { rows, shared, perService } = buildScheduleFromStructures([{ altItem: 'Other', fee: 9 }], [
    { service: 'A', rows: [{ feeName: 'Program fee', fee: 1, unit: 'Fixed' }, { feeName: 'A only', fee: 5, unit: 'Fixed' }], replaceNames: [] },
    { service: 'B', rows: [{ feeName: 'program fee', fee: 2, unit: 'Fixed' }], replaceNames: ['Program fee'] },
  ]);
  assert.deepEqual(rows.map(r => [r.altItem, r.fee]), [['Other', 9], ['Program fee', 1], ['program fee', 2], ['A only', 5]]);
  assert.deepEqual(shared, [{ fee: 'Program fee', services: ['A', 'B'], unpriced: [] }]);
  assert.deepEqual(perService[1].removed, []);
});

test('a shared fee drops a blank row when a sibling has a fee', () => {
  const { rows, shared } = buildScheduleFromStructures([], [
    { service: 'A', rows: [{ feeName: 'Per account', fee: 1.5, unit: 'Per Account' }], replaceNames: [] },
    { service: 'B', rows: [{ feeName: 'Per account', fee: null, unit: 'Per Account' }], replaceNames: [] },
  ], { accountCount: 10 });
  assert.deepEqual(rows.map(r => r.fee), [1.5]);
  assert.deepEqual(shared, [{ fee: 'Per account', services: ['A'], unpriced: ['B'] }]);
});

test('groupFeeRows folds repeated names under one line', () => {
  const g = groupFeeRows([
    { name: 'Fee', service: 'A', type: 'Recurring (monthly)', feePerUnit: 1, unit: 'Per Site', unitCount: 5, startMonth: 4, years: [10, 20], term: 30 },
    { name: 'Solo', service: null, type: 'Setup', feePerUnit: 3, unit: 'Fixed', unitCount: 1, startMonth: 1, years: [3, 0], term: 3 },
    { name: 'fee', service: 'B', type: 'Recurring (monthly)', feePerUnit: 2, unit: 'Per Site', unitCount: 5, startMonth: 1, years: [1, 2], term: 3 },
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].subRows.length, 2);
  assert.deepEqual(g[0].row.years, [11, 22]);
  assert.equal(g[0].row.term, 33);
  assert.equal(g[0].row.feePerUnit, 3);
  assert.equal(g[0].row.startMonth, 1);
  assert.equal(g[0].row.service, 'A, B');
  assert.equal(g[1].subRows.length, 0);
  const mixed = groupFeeRows([
    { name: 'X', feePerUnit: 1, unit: 'Per Site', unitCount: 5, years: [] },
    { name: 'X', feePerUnit: 2, unit: 'Fixed', unitCount: 1, years: [] },
  ]);
  assert.equal(mixed[0].row.feePerUnit, null);
  assert.equal(mixed[0].row.unit, 'Mixed');
});

test('groupFeeRows sums cost and gives the group a margin', () => {
  const g = groupFeeRows([
    { name: 'Fee', years: [100], term: 100, cost: 60, margin: 0.4 },
    { name: 'Fee', years: [100], term: 100, cost: 20, margin: 0.8 },
  ]);
  assert.equal(g[0].row.cost, 80);
  assert.equal(g[0].row.margin, 0.6);
  assert.equal(groupFeeRows([{ name: 'A', years: [1] }, { name: 'A', years: [1] }])[0].row.margin, undefined);
});

test('a dropped blank row hands its costs to the row that stays', () => {
  const { rows } = buildScheduleFromStructures([], [
    { service: 'A', rows: [{ feeName: 'Per account', fee: 1.5, unit: 'Fixed', costIds: ['a1'] }], replaceNames: [] },
    { service: 'B', rows: [{ feeName: 'Per account', fee: null, unit: 'Fixed', costIds: ['b1'] }], replaceNames: [] },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].costIds, ['a1', 'b1']);
});

test('a cost no row names falls to the first row that can bill it', () => {
  // A "Program fee" structure on a service whose costs carry "BBS per site".
  const costs = [
    { key: costKey('BBS setup', 'One Time'), description: 'BBS setup', type: 'One Time', price: 720, startMonth: 1, feeNames: ['BBS per site'] },
    { key: costKey('BBS monthly', 'Recurring (monthly)'), description: 'BBS monthly', type: 'Recurring (monthly)', price: 40, startMonth: 1, feeNames: ['BBS per site'] },
  ];
  const monthly = [{ feeName: 'Program fee', type: 'Recurring (monthly)', unit: 'Fixed', unitCount: 1 }];
  let r = standardFeesForStructure({ rows: monthly, costs, termMonths: 36 });
  assert.deepEqual(r.costs.map(c => [c.rowIdx, c.fellBack, c.issue]), [[0, true, ''], [0, true, '']]);
  assert.equal(r.perRow[0].standardFee, 60); // 40 + 720 / 36, the setup rolled over the term
  // An upfront row takes the upfront cost; the monthly one goes to the monthly row.
  const both = [{ feeName: 'Setup', type: 'One Time', unit: 'Fixed', unitCount: 1 }, ...monthly];
  r = standardFeesForStructure({ rows: both, costs, termMonths: 36 });
  assert.deepEqual(r.costs.map(c => c.rowIdx), [0, 1]);
  assert.equal(r.perRow[0].standardFee, 720);
  assert.equal(r.perRow[1].standardFee, 40);
  // Only upfront rows: the monthly cost stays uncovered.
  r = standardFeesForStructure({ rows: both.slice(0, 1), costs, termMonths: 36 });
  assert.deepEqual(r.costs.map(c => c.rowIdx), [0, -1]);
  // "Not covered" still takes a cost out, and a named row still wins.
  r = standardFeesForStructure({ rows: monthly, costs, allocations: { [costs[0].key]: { fee: '' } }, termMonths: 36 });
  assert.equal(r.costs[0].rowIdx, -1);
  assert.equal(r.perRow[0].standardFee, 40);
  r = standardFeesForStructure({ rows: [...monthly, { feeName: 'BBS per site', type: 'Recurring (monthly)', unit: 'Fixed' }], costs, termMonths: 36 });
  assert.deepEqual(r.costs.map(c => [c.rowIdx, c.fellBack]), [[1, false], [1, false]]);
});

test('a first-in-scope line item goes to the first service another line ties to', () => {
  const map = {
    'dbp setup': ['Bill payment', 'Invoice collection'],
    'dbp pay now': ['Bill payment'],
    'collections': ['Invoice collection'],
  };
  const prio = { 'dbp setup': true };
  const withBp = effectiveLineItemServices([{ description: 'DBP Setup' }, { description: 'DBP Pay Now' }], map, prio);
  assert.deepEqual(withBp['dbp setup'], ['Bill payment']);
  assert.deepEqual(withBp['dbp pay now'], ['Bill payment']);
  // No other line ties to Bill payment: the next service that is in scope takes it.
  const withoutBp = effectiveLineItemServices([{ description: 'DBP Setup' }, { description: 'Collections' }], map, prio);
  assert.deepEqual(withoutBp['dbp setup'], ['Invoice collection']);
  // Nothing else in scope: the first pick.
  assert.deepEqual(effectiveLineItemServices([{ description: 'DBP Setup' }], map, prio)['dbp setup'], ['Bill payment']);
  // Not flagged: shared by every service, as before.
  assert.equal(effectiveLineItemServices([{ description: 'DBP Setup' }], map, {}), map);
  // And the costs follow it.
  const items = [{ description: 'DBP Setup' }, { description: 'Collections' }];
  assert.deepEqual(costItemsForService(items, withBp, 'Invoice collection').map(i => i.description), ['Collections']);
});

test('pass-through lines each get a fee row of their own, at cost', () => {
  const costs = [
    { description: 'Invoice - Data', type: 'Recurring (monthly)', cts: 227.84, startMonth: 4 },
    { description: 'DBP - Partner A/C Setup & Imp.', type: 'Setup', cts: 4835.5, startMonth: 1, passThrough: true },
    { description: 'DBP - Partner Ongoing', type: 'Recurring (monthly)', cts: 648.75, startMonth: 4, passThrough: true, perAccount: true },
    { description: 'Left out', type: 'Setup', cts: 10, passThrough: true, ignored: true },
  ];
  const unitOf = (c) => (c.perAccount ? 'Per Account' : 'Fixed');
  const st = { id: 's', name: 'Per account monthly', rows: [{ feeName: 'Per account monthly', type: 'Recurring (monthly)', unit: 'Per Account' }] };
  const next = addPassThroughFees(st, costs, { unitOf });
  assert.deepEqual(next.rows.slice(1).map(r => [r.feeName, r.type, r.unit, r.startMonth, r.passThrough]), [
    ['DBP - Partner A/C Setup & Imp.', 'Setup', 'Fixed', null, true],
    ['DBP - Partner Ongoing', 'Recurring (monthly)', 'Per Account', 4, true],
  ]);
  assert.equal(next.rows[0].feeName, 'Per account monthly', 'existing row kept first');
  // Each cost pinned to its own row.
  assert.equal(next.allocations[costKey('DBP - Partner Ongoing', 'Recurring (monthly)', 4)].fee, 'dbp - partner ongoing');
  const std = standardFeesForStructure({ rows: next.rows, costs: costs.filter(c => !c.ignored).map(c => ({ key: costKey(c.description, c.type, c.startMonth), description: c.description, type: c.type, price: c.cts, startMonth: c.startMonth, feeNames: [] })), allocations: next.allocations, accountCount: 519 });
  assert.equal(std.costs[1].rowIdx, 1);
  assert.equal(std.costs[2].rowIdx, 2);
  // Run again: nothing left to add.
  assert.equal(passThroughFeeRows(next, costs, { unitOf }).length, 0);
  assert.equal(addPassThroughFees(next, costs, { unitOf }), next);
});

test('a shared line item asks which service each of its cost lines goes to', () => {
  const items = [
    { description: 'Communication Support', type: 'Setup', cts: 100 },
    { description: 'Communication Support', type: 'Recurring', cts: 40 },
    { description: 'Communication Support', type: 'Recurring', cts: 60 },
    { description: 'Commercial Client Management NAM', type: 'Recurring', cts: 10 },
  ];
  let map = {
    'communication support': ['Sustainability Reports', 'Marketing Collateral'],
    'commercial client management nam': ['GHG'],
  };
  let rows = sharedLineItemsToSplit(items, map);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'communication support');
  assert.deepEqual(rows[0].lines.map(l => [l.type, l.count, l.cts, l.pick]), [['Setup', 1, 100, null], ['Recurring', 2, 100, null]]);
  // Priority, ignored and kept-shared line items aren't asked about.
  assert.equal(sharedLineItemsToSplit(items, map, { priority: { 'communication support': true } }).length, 0);
  assert.equal(sharedLineItemsToSplit(items, map, { ignored: { 'communication support': true } }).length, 0);
  const ok = { 'communication support': sharedSignature(['marketing collateral', 'Sustainability Reports']) };
  assert.equal(sharedLineItemsToSplit(items, map, { sharedOk: ok }).length, 0);
  // ...until the list changes.
  const grown = { ...map, 'communication support': [...map['communication support'], 'GHG'] };
  assert.equal(sharedLineItemsToSplit(items, grown, { sharedOk: ok }).length, 1);
  // Splitting one line keeps asking about the other; splitting both settles it.
  map = setCostLineService(map, items[0], 'Marketing Collateral');
  rows = sharedLineItemsToSplit(items, map);
  assert.deepEqual(rows[0].lines.map(l => l.pick), ['Marketing Collateral', null]);
  assert.deepEqual(servicesForCostLine(map, items[1]), ['Sustainability Reports', 'Marketing Collateral']);
  map = setCostLineService(map, items[1], 'Sustainability Reports');
  assert.equal(sharedLineItemsToSplit(items, map).length, 0);
  assert.deepEqual(costItemsForService(items, map, 'Marketing Collateral').map(i => i.type), ['Setup']);
  // A blank pick puts the line back on the shared list.
  map = setCostLineService(map, items[0], '');
  assert.deepEqual(servicesForCostLine(map, items[0]), ['Sustainability Reports', 'Marketing Collateral']);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }

test('costs by kind split a side\'s counted cost lines into One Time, Setup and Recurring by year', () => {
  const lines = [
    { type: 'One Time', byYear: [100, 0, 0], on: true },
    { type: 'One Time Rolled', byYear: [10, 10, 10], on: true },
    { type: 'Setup', byYear: [500, 0, 0], on: true },
    { type: 'Recurring (monthly)', byYear: [1200, 1246, 1294], on: true },
    { type: 'Recurring (monthly)', byYear: [999, 999, 999], on: false },
  ];
  const { rows, total } = costsByKind(lines, 3, (c) => c.on);
  assert.deepEqual(rows.map(r => [r.kind, r.byYear]), [
    ['One Time', [110, 10, 10]],
    ['Setup', [500, 0, 0]],
    ['Recurring', [1200, 1246, 1294]],
  ]);
  assert.deepEqual(total, [1810, 1256, 1304]);
  assert.equal(costKindOf('Setup Rolled'), 'Setup');
  const other = costsByKind([{ type: 'Fee = $6.75/account', byYear: [5] }], 1);
  assert.deepEqual(other.rows.map(r => r.kind), ['One Time', 'Setup', 'Recurring', 'Other']);
});
