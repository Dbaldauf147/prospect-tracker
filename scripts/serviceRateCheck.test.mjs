// The Pricing page's Services subtab price check: a service's SIA cost,
// marked up, against the range its Dropdowns rate card quotes.
// Plain Node, no test framework. Run:
//   node scripts/serviceRateCheck.test.mjs

import assert from 'node:assert/strict';
import { rateCardCheck, year1CostOf, RATE_CHECK, siaCountsFor, priceCheckCounts, checkPartOf, feeUnitCountsFor, componentForFeeUnit, lineFeeCounts, priceCheckCountsWithLines } from '../src/utils/serviceRateCheck.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const recurring = { serviceType: 'Recurring', years: '3 years' };
const project = { serviceType: 'Project', years: '1 year' };

test('recurring CTS counts twelve months, one-time once, pass-through on its own', () => {
  const r = year1CostOf([
    { cts: 100, type: 'Recurring' },
    { cts: 500, type: 'One-time' },
    { cts: 999, type: 'Recurring', passThrough: true },
    { cts: null, type: 'Recurring' },
  ]);
  assert.equal(r.cost, 1700);
  assert.equal(r.counted, 2);
  assert.equal(r.passThrough, 1);
});

test('pass-through lines stay out of the rate card components and get a line each', () => {
  const c = rateCardCheck({
    items: [
      { id: 'mgmt', cts: 1000, type: 'Recurring' },
      { id: 'data', cts: 200, type: 'Recurring', feeComponent: 'recurring:per_account' },
      { id: 'ongoing', description: 'Partner Ongoing', cts: 648.75, type: 'Recurring (monthly)', startMonth: '4', passThrough: true, feeComponent: 'pass:per_account' },
      { id: 'setup', description: 'Partner Setup', cts: 4835.5, type: 'Setup', passThrough: true },
      { id: 'old', description: 'Picked before', cts: 10, type: 'Recurring', passThrough: true, feeComponent: 'recurring:per_account' },
    ],
    entry: { basis: 'flat', rate: 20000, rateHigh: 30000, lines: [{ basis: 'per_account', rate: 10, rateHigh: 20 }] },
    meta: recurring,
    counts: { accounts: 519 },
  });
  const ongoing = c.parts.find(p => p.key === 'recurring');
  const perAccount = ongoing.components.rows.find(r => r.id === 'recurring:per_account');
  // Only the one non-pass-through line picked for it: 200 × 12.
  assert.equal(perAccount.picked, 1);
  assert.equal(perAccount.cost, 2400);
  assert.equal(c.parts.find(p => p.key === 'setup'), undefined, 'no setup bucket from a pass-through cost');
  assert.equal(c.passThrough, 3);

  const [on, set, old] = c.passThroughLines;
  // A year of the monthly cost, at cost, over 519 accounts.
  assert.equal(on.amount, 7785);
  assert.equal(on.model, 'pass:per_account');
  assert.equal(on.perUnit, 15);
  assert.equal(on.partLabel, 'Ongoing');
  // A setup line is pickable too; with nothing picked it is a fixed fee.
  assert.equal(set.model, 'pass:fixed');
  assert.equal(set.amount, 4835.5);
  assert.equal(set.perUnit, null);
  assert.equal(set.partLabel, 'Setup / one-time');
  // A pick from when pass-through sat in the components carries over.
  assert.equal(old.model, 'pass:per_account');
});

test('per account with no account count says so', () => {
  const c = rateCardCheck({
    items: [{ id: 'x', cts: 100, type: 'Setup', passThrough: true, feeComponent: 'pass:per_account' }],
    entry: { basis: 'flat', rate: 1000 },
    meta: recurring,
  });
  assert.equal(c.passThroughLines[0].needsAccounts, true);
  assert.equal(c.passThroughLines[0].perUnit, null);
});

test('priced at 50% margin and inside a per-site range', () => {
  const c = rateCardCheck({
    items: [{ cts: 1000, type: 'Recurring' }],
    entry: { basis: 'per_site', rate: 100, rateHigh: 300 },
    meta: recurring,
    counts: { sites: 100 },
  });
  assert.equal(c.cost, 12000);
  assert.equal(c.price, 24000); // 12,000 / (1 - 50%)
  assert.equal(c.margin, 0.5);
  assert.equal(c.low, 10000);
  assert.equal(c.high, 30000);
  assert.equal(c.status, RATE_CHECK.WITHIN);
});

test('below and above the range', () => {
  const entry = { basis: 'flat', rate: 10000, rateHigh: 20000 };
  assert.equal(rateCardCheck({ items: [{ cts: 4000, type: 'One-time' }], entry, meta: project }).status, RATE_CHECK.BELOW);
  assert.equal(rateCardCheck({ items: [{ cts: 15000, type: 'One-time' }], entry, meta: project }).status, RATE_CHECK.ABOVE);
});

test('setup fee is part of the year 1 range', () => {
  const c = rateCardCheck({
    items: [{ cts: 7500, type: 'One-time' }],
    entry: { basis: 'flat', rate: 5000, setupLines: [{ basis: 'flat', rate: 10000 }] },
    meta: project,
  });
  assert.equal(c.low, 15000);
  assert.equal(c.status, RATE_CHECK.WITHIN);
});

test('no rate card, or no cost, says so rather than guessing', () => {
  assert.equal(rateCardCheck({ items: [{ cts: 100, type: 'Recurring' }], entry: {}, meta: recurring }).status, RATE_CHECK.UNPRICED);
  const noFee = rateCardCheck({ items: [{ cts: 100, type: 'Recurring' }], entry: { noFee: true }, meta: recurring });
  assert.equal(noFee.status, RATE_CHECK.UNPRICED);
  assert.equal(noFee.noFee, true);
  assert.equal(rateCardCheck({ items: [{ cts: 0, type: 'Fee' }], entry: { basis: 'flat', rate: 100 }, meta: project }).status, RATE_CHECK.NO_COST);
});

test('a count the SIA does not carry comes back as a note', () => {
  const c = rateCardCheck({
    items: [{ cts: 10, type: 'Recurring' }],
    entry: { basis: 'per_meter', rate: 5 },
    meta: recurring,
    counts: { sites: 3 },
  });
  assert.ok(c.notes.some(n => /meters/i.test(n)));
  assert.equal(c.status, RATE_CHECK.INCOMPLETE);
  assert.deepEqual(c.missing, [{ key: 'meters', label: 'Meters' }]);
});

test('a $0 range from a missing count is not "above range"', () => {
  const c = rateCardCheck({
    items: [{ cts: 268, type: 'One-time' }],
    entry: { basis: 'per_site_mandate', rate: 100 },
    meta: project,
    counts: { sites: 29, accounts: 519 },
  });
  assert.equal(c.high, 0);
  assert.equal(c.status, RATE_CHECK.INCOMPLETE);
  assert.deepEqual(c.missing, [{ key: 'sites_mandate', label: 'Sites w/ Mandate' }]);
});

test('a count typed in fills the gap', () => {
  const c = rateCardCheck({
    items: [{ cts: 268, type: 'One-time' }],
    entry: { basis: 'per_site_mandate', rate: 100 },
    meta: project,
    counts: { sites: 29, sites_mandate: 6 },
  });
  assert.equal(c.low, 600);
  assert.equal(c.status, RATE_CHECK.BELOW);
  assert.deepEqual(c.missing, []);
});

test('a percentage fee asks for, and prices on, a deal size', () => {
  const entry = { basis: 'pct_deal', rate: 10 };
  const before = rateCardCheck({ items: [{ cts: 100, type: 'One-time' }], entry, meta: project });
  assert.deepEqual(before.missing, [{ key: 'dealSize', label: 'Deal size' }]);
  const after = rateCardCheck({ items: [{ cts: 100, type: 'One-time' }], entry, meta: project, counts: { dealSize: 3000 } });
  assert.equal(after.low, 300);
  assert.equal(after.status, RATE_CHECK.BELOW);
});

test('only months 1 to 12 are year 1', () => {
  const r = year1CostOf([
    { cts: 670, type: 'One Time', startMonth: 1 },
    { cts: 402, type: 'One Time', startMonth: 13 },
    { cts: 100, type: 'Recurring', startMonth: 4 },
    { cts: 100, type: 'Recurring', startMonth: 14 },
  ]);
  assert.equal(r.cost, 670 + 900);
  assert.equal(r.runRate, 1200);
  assert.equal(r.counted, 2);
  assert.equal(r.later, 2);
});

test('each part of the fee model is checked against its own card lines', () => {
  const c = rateCardCheck({
    items: [
      { cts: 2750, type: 'Setup', startMonth: 1 },
      { cts: 4835.5, type: 'Setup', startMonth: 1 },
      { cts: 648.75, type: 'Recurring (monthly)', startMonth: 4 },
      { cts: null, type: 'Fee = $6.75/account' },
    ],
    entry: { basis: 'per_account', rate: 10, rateHigh: 20, setupLines: [{ basis: 'flat', rate: 5000, rateHigh: 8000 }] },
    meta: recurring,
    counts: { sites: 29, accounts: 519 },
  });
  const by = Object.fromEntries(c.parts.map(p => [p.key, p]));
  assert.deepEqual(Object.keys(by), ['setup', 'recurring']);
  // Setup: 7,585.50 × 2 = 15,171 against 5,000 to 8,000.
  assert.equal(by.setup.status, RATE_CHECK.ABOVE);
  assert.equal(by.setup.low, 5000);
  assert.equal(by.setup.perUnit, null);
  // Ongoing, per account: 648.75 × 12 × 2 / 519 = 30 against $10 to $20.
  assert.equal(by.recurring.cost, 648.75 * 12);
  assert.equal(by.recurring.perUnit.unitLabel, 'Accounts');
  assert.ok(Math.abs(by.recurring.perUnit.price - 30) < 1e-9);
  assert.equal(by.recurring.perUnit.rateLow, 10);
  assert.equal(by.recurring.perUnit.rateHigh, 20);
  assert.equal(by.recurring.status, RATE_CHECK.ABOVE);
});

test('a cost the card has no line for is called out, and a card line with no cost too', () => {
  const c = rateCardCheck({
    items: [{ cts: 1000, type: 'Setup' }],
    entry: { basis: 'per_site', rate: 100 },
    meta: recurring,
    counts: { sites: 10 },
  });
  const by = Object.fromEntries(c.parts.map(p => [p.key, p]));
  assert.equal(by.setup.status, RATE_CHECK.NOT_ON_CARD);
  assert.equal(by.recurring.status, RATE_CHECK.NO_COST);
  assert.equal(by.oneTime, undefined);
});

test('an option without its own sites takes another option sheet\'s', () => {
  const o1 = { sheetName: 'Option 1', siteCount: null };
  const o5 = { sheetName: 'Option 5', siteCount: 29, accountCount: 1 };
  const wb = { options: [o1, o5] };
  assert.deepEqual(siaCountsFor(wb, o1), { sites: 29, accounts: 1, sitesFrom: 'Option 5', accountsFrom: 'Option 5', kwh: null, dth: null });
  assert.deepEqual(siaCountsFor(wb, o5), { sites: 29, accounts: 1, sitesFrom: null, accountsFrom: null, kwh: null, dth: null });
  assert.deepEqual(siaCountsFor({ options: [o1] }, o1), { sites: null, accounts: null, sitesFrom: null, accountsFrom: null, kwh: null, dth: null });
});

test('the SIA header kWh and Dth come through, own option first', () => {
  const head = (kwh, dth) => [{ label: 'Annual kWh', value: kwh }, { label: 'Annual Dth', value: dth }];
  const o1 = { sheetName: 'Option 1', headerDetails: [] };
  const o2 = { sheetName: 'Option 2', headerDetails: head('1,200,000', '4500') };
  const o3 = { sheetName: 'Option 3', headerDetails: head('900', '') };
  const wb = { options: [o1, o2, o3] };
  const pick = (o) => { const c = siaCountsFor(wb, o); return [c.kwh, c.dth]; };
  assert.deepEqual(pick(o1), [1200000, 4500]);
  assert.deepEqual(pick(o3), [900, 4500]);
  assert.deepEqual(feeUnitCountsFor({ sia: siaCountsFor(wb, o2) }).kwhCount, 1200000);
});

test('the SIA sites price a per-site-w/-mandate card, and a typed count wins', () => {
  const { counts, fromSia } = priceCheckCounts({ sites: 29, accounts: 1 }, {});
  assert.equal(counts.sites_mandate, 29);
  assert.equal(fromSia.sites_mandate, 29);
  const c = rateCardCheck({
    items: [{ cts: 268, type: 'One Time' }],
    entry: { basis: 'per_site_mandate', rate: 625, rateHigh: 825 },
    meta: project,
    counts,
  });
  assert.equal(c.low, 625 * 29);
  assert.notEqual(c.status, RATE_CHECK.INCOMPLETE);
  assert.deepEqual(c.unitsUsed, ['sites_mandate']);
  const typed = priceCheckCounts({ sites: 29 }, { sites_mandate: 4 });
  assert.equal(typed.counts.sites_mandate, 4);
  assert.equal(typed.fromSia.sites_mandate, 29);
});

test('a card that is one per-unit rate is checked per unit, not on the total', () => {
  // BBS: $625 to $825 a year per site w/ mandate, 29 sites.
  const c = rateCardCheck({
    items: [
      { cts: 290, type: 'Recurring (monthly)', startMonth: 1 },
      { cts: 536, type: 'One Time', startMonth: 1 },
    ],
    entry: { basis: 'per_site_mandate', rate: 625, rateHigh: 825 },
    meta: recurring,
    counts: { sites_mandate: 29 },
  });
  const year1 = 290 * 12 + 536;
  assert.equal(c.cost, year1);
  assert.equal(c.perUnit.units, 29);
  assert.equal(c.perUnit.basisLabel, 'Per site w/ mandate');
  assert.ok(Math.abs(c.perUnit.cost - year1 / 29) < 1e-9);
  assert.ok(Math.abs(c.perUnit.price - year1 * 2 / 29) < 1e-9); // $276.97 a site
  assert.equal(c.perUnit.rateLow, 625);
  assert.equal(c.perUnit.rateHigh, 825);
  assert.equal(c.status, RATE_CHECK.BELOW);
  // More than one card line stays a check on the total.
  const two = rateCardCheck({
    items: [{ cts: 100, type: 'Setup' }, { cts: 10, type: 'Recurring (monthly)' }],
    entry: { basis: 'per_site', rate: 100, setupLines: [{ basis: 'flat', rate: 500 }] },
    meta: recurring,
    counts: { sites: 10 },
  });
  assert.equal(two.perUnit, null);
});

test('each cost is priced at its own margin when it carries one', () => {
  const c = rateCardCheck({
    items: [
      { cts: 1000, type: 'Recurring (monthly)', startMonth: 1, margin: 0.75 },
      { cts: 100, type: 'One Time', startMonth: 1, margin: 0.75 },
    ],
    entry: { basis: 'per_site_mandate', rate: 625, rateHigh: 825 },
    meta: recurring,
    counts: { sites_mandate: 80 },
  });
  // (12,000 + 100) x 4 / 80 = $605 a site, just under the card.
  assert.equal(c.margin, 0.75);
  assert.ok(Math.abs(c.perUnit.price - 605) < 1e-9);
  assert.equal(c.status, RATE_CHECK.BELOW);
  // Mixed margins report none, and each line keeps its own.
  const mixed = rateCardCheck({
    items: [
      { cts: 1000, type: 'Recurring (monthly)', startMonth: 1, margin: 0.75 },
      { cts: 100, type: 'One Time', startMonth: 1 },
    ],
    entry: { basis: 'per_site_mandate', rate: 625, rateHigh: 825 },
    meta: recurring,
    counts: { sites_mandate: 80 },
  });
  assert.equal(mixed.margin, null);
  assert.ok(Math.abs(mixed.price - (12000 * 4 + 100 * 2)) < 1e-9);
  const rec = mixed.parts.find(p => p.key === 'recurring');
  assert.ok(Math.abs(rec.price - 48000) < 1e-9);
});

test('a $0 setup line on the card does not stop a one-rate card being checked per unit', () => {
  // Invoice variance testing: $4.80 to $5 per account a year, setup left at $0.
  const c = rateCardCheck({
    items: [{ cts: 100, type: 'Recurring (monthly)', startMonth: 1 }],
    entry: { basis: 'per_account', rate: 4.8, rateHigh: 5, setupLines: [{ basis: 'per_account', rate: 0, rateHigh: 0 }] },
    meta: { serviceType: 'Recurring', years: 1 },
    counts: { accounts: 519 },
  });
  assert.ok(c.perUnit, 'checked per account');
  assert.equal(c.perUnit.unitLabel, 'Accounts');
  assert.equal(c.perUnit.units, 519);
  assert.equal(c.perUnit.rateLow, 4.8);
  assert.equal(c.perUnit.rateHigh, 5);
  assert.equal(c.status, RATE_CHECK.BELOW); // $1,200 x 2 / 519 = $4.62 an account
  assert.ok(!c.parts.some(p => p.key === 'setup'), 'no setup part for a $0 setup with no setup cost');
});

test('a card quoted per month is checked per month, with the totals kept annual', () => {
  // Budgets (account level): $2 to $2.50 per account a month; $500 a month of cost.
  const c = rateCardCheck({
    items: [{ cts: 500, type: 'Recurring (monthly)', startMonth: 1 }],
    entry: { basis: 'per_account', rate: 2, rateHigh: 2.5, monthly: true },
    meta: { serviceType: 'Recurring', years: '3 years' },
    counts: { accounts: 519 },
  });
  assert.equal(c.low, 2 * 519 * 12);
  assert.equal(c.high, 2.5 * 519 * 12);
  assert.equal(c.perUnit.perMonth, true);
  assert.equal(c.perUnit.totalCost, 500);
  assert.ok(Math.abs(c.perUnit.price - 500 * 2 / 519) < 1e-9); // $1.93 an account a month
  assert.equal(c.perUnit.rateLow, 2);
  assert.equal(c.perUnit.rateHigh, 2.5);
  assert.equal(c.status, RATE_CHECK.BELOW);
  // The same card read per year compares year 1 against the rate, as before.
  const annual = rateCardCheck({
    items: [{ cts: 500, type: 'Recurring (monthly)', startMonth: 1 }],
    entry: { basis: 'per_account', rate: 2, rateHigh: 2.5 },
    meta: { serviceType: 'Recurring', years: '3 years' },
    counts: { accounts: 519 },
  });
  assert.equal(annual.perUnit.perMonth, false);
  assert.equal(annual.status, RATE_CHECK.ABOVE);
});

test('tech depreciation is added before the margin: $268 at 50% is $557.44', () => {
  // BBS reporting: $268 a year, now annual, one site w/ mandate, 4% tech depreciation.
  const c = rateCardCheck({
    items: [{ cts: 268 / 12, type: 'Recurring (monthly)', startMonth: 1 }],
    entry: { basis: 'per_site_mandate', rate: 625, rateHigh: 825 },
    meta: recurring,
    counts: { sites_mandate: 1 },
    techDeprPct: 0.04,
  });
  assert.ok(Math.abs(c.perUnit.cost - 268) < 1e-9);
  assert.ok(Math.abs(c.perUnit.price - 557.44) < 1e-9);
  assert.equal(c.techDeprPct, 0.04);
  assert.equal(c.status, RATE_CHECK.BELOW);
});

test('a per-site card with a setup the SIA has no cost for is checked per site', () => {
  // ESPM link: $39 to $41 a site a year, plus a $500 setup on the card.
  // The SIA carries only the monthly costs.
  const c = rateCardCheck({
    items: [
      { cts: 22.33, type: 'Recurring (monthly)', startMonth: 1 },
      { cts: 1.57, type: 'Recurring (monthly)', startMonth: 1 },
    ],
    entry: { basis: 'per_site', rate: 39, rateHigh: 41, setupLines: [{ basis: 'flat', rate: 500 }] },
    meta: recurring,
    counts: { sites: 29, sites_mandate: 1 },
  });
  assert.ok(c.perUnit, 'per-unit check');
  assert.equal(c.perUnit.part, 'Ongoing');
  assert.equal(c.perUnit.units, 29);
  assert.equal(c.perUnit.rateLow, 39);
  assert.equal(c.perUnit.rateHigh, 41);
  // 23.90 x 12 at 50% margin = 573.60 a year, over 29 sites = 19.78.
  assert.ok(Math.abs(c.perUnit.price - 23.9 * 12 * 2 / 29) < 1e-9);
  assert.equal(c.status, RATE_CHECK.BELOW);
  assert.equal(c.leftOut.length, 1);
  assert.equal(c.leftOut[0].fee, 500);
  // Both components are listed with their own rates.
  assert.deepEqual(c.parts.map(pt => pt.key), ['setup', 'recurring']);
  assert.equal(c.parts[0].status, RATE_CHECK.NO_COST);
});

test('two components the SIA has costs for stay a check on the total', () => {
  const c = rateCardCheck({
    items: [{ cts: 100, type: 'Setup' }, { cts: 10, type: 'Recurring (monthly)' }],
    entry: { basis: 'per_site', rate: 39, setupLines: [{ basis: 'flat', rate: 500 }] },
    meta: recurring,
    counts: { sites: 29 },
  });
  assert.equal(c.perUnit, null);
  assert.deepEqual(c.leftOut, []);
});

test('cardUnits words the units the card prices on the way a fee Unit reads', () => {
  const cert = rateCardCheck({
    items: [{ cts: 7889.92, type: 'One Time' }],
    entry: { basis: 'per_project', rate: 1500, rateHigh: 2000 },
    meta: project,
    counts: { projects: 1 },
  });
  assert.deepEqual(cert.cardUnits, ['Per Project']);
  const two = rateCardCheck({
    items: [{ cts: 200, type: 'Recurring (monthly)' }],
    entry: { basis: 'recurring_annual', rate: 42000, rateHigh: 84000, lines: [{ basis: 'per_account', rate: 32, rateHigh: 46 }] },
    meta: recurring,
    counts: { accounts: 519 },
  });
  assert.deepEqual(two.cardUnits, ['Fixed', 'Per Account']);
});

// Ongoing on two components: $42,000 to $84,000 a year, plus $32 to $46 per
// account a year, over 519 accounts.
const twoComponents = { basis: 'recurring_annual', rate: 42000, rateHigh: 84000, lines: [{ basis: 'per_account', rate: 32, rateHigh: 46 }] };
const ongoingOf = (c) => c.parts.find(p => p.key === 'recurring');

test('an ongoing part on two components lists each, checked together until lines are picked', () => {
  const c = rateCardCheck({
    items: [{ id: 'a', cts: 200, type: 'Recurring (monthly)' }, { id: 'b', cts: 80, type: 'Recurring (monthly)' }],
    entry: twoComponents,
    meta: recurring,
    counts: { accounts: 519 },
  });
  assert.deepEqual(c.componentChoices.recurring.map(x => x.id), ['recurring:recurring_annual', 'recurring:per_account']);
  const { rows, shared, loose } = ongoingOf(c).components;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].low, 42000);
  assert.equal(rows[1].low, 32 * 519);
  assert.ok(rows.every(r => r.shared && r.lineCount === 0));
  assert.equal(shared.cost, 280 * 12);
  assert.equal(shared.low, 42000 + 32 * 519);
  assert.equal(shared.status, RATE_CHECK.BELOW);
  assert.equal(loose, null);
});

test('a line picked for one component leaves the rest to the other', () => {
  const c = rateCardCheck({
    items: [
      { id: 'a', cts: 4000, type: 'Recurring (monthly)' },
      { id: 'b', cts: 1000, type: 'Recurring (monthly)', feeComponent: 'recurring:per_account' },
    ],
    entry: twoComponents,
    meta: recurring,
    counts: { accounts: 519 },
  });
  const { rows, shared } = ongoingOf(c).components;
  assert.equal(shared, null);
  const [flat, perAccount] = rows;
  // 4,000 x 12 x 2 = $96,000 a year, over the $84,000 top.
  assert.equal(flat.auto, 1);
  assert.equal(flat.price, 96000);
  assert.equal(flat.status, RATE_CHECK.ABOVE);
  // 1,000 x 12 x 2 / 519 = $46.24 an account, just over $46.
  assert.equal(perAccount.picked, 1);
  assert.ok(Math.abs(perAccount.perUnit.price - 24000 / 519) < 1e-9);
  assert.equal(perAccount.status, RATE_CHECK.ABOVE);
  // The whole-service check is untouched by the split.
  assert.equal(c.price, 5000 * 12 * 2);
});

test('a component with nothing on it reads no cost, and a pick for another part is ignored', () => {
  const c = rateCardCheck({
    items: [
      { id: 'a', cts: 1000, type: 'Recurring (monthly)', feeComponent: 'recurring:recurring_annual' },
      { id: 'b', cts: 50, type: 'Recurring (monthly)', feeComponent: 'setup:flat' },
    ],
    entry: twoComponents,
    meta: recurring,
    counts: { accounts: 519 },
  });
  const [flat, perAccount] = ongoingOf(c).components.rows;
  assert.equal(flat.picked, 1);
  assert.equal(flat.cost, 12000);
  // The stray pick is treated as Auto and lands on the open component.
  assert.equal(perAccount.auto, 1);
  assert.equal(perAccount.cost, 600);
});

test('lines left on Auto when every component has its own are reported, not dropped', () => {
  const c = rateCardCheck({
    items: [
      { id: 'a', cts: 1000, type: 'Recurring (monthly)', feeComponent: 'recurring:recurring_annual' },
      { id: 'b', cts: 100, type: 'Recurring (monthly)', feeComponent: 'recurring:per_account' },
      { id: 'c', cts: 7, type: 'Recurring (monthly)' },
    ],
    entry: twoComponents,
    meta: recurring,
    counts: { accounts: 519 },
  });
  const { loose } = ongoingOf(c).components;
  assert.equal(loose.lineCount, 1);
  assert.equal(loose.cost, 84);
});

test('a Setup Rolled cost is ongoing money, spread over the term, and can pick an ongoing component', () => {
  const c = rateCardCheck({
    items: [
      { id: 'r', cts: 3600, type: 'Setup Rolled', startMonth: 1 },
      { id: 's', cts: 500, type: 'Setup', startMonth: 1 },
    ],
    entry: twoComponents,
    meta: recurring,
    counts: { accounts: 519 },
    termMonths: 36,
  });
  // $3,600 over 36 months is $100 a month: $1,200 a year, ongoing.
  const on = ongoingOf(c);
  assert.equal(on.cost, 1200);
  assert.equal(c.parts.find(p => p.key === 'setup').cost, 500);
  assert.equal(c.cost, 1700);
  assert.equal(c.setupOffCard, true);
  assert.equal(checkPartOf({ cts: 1, type: 'Setup Rolled' }), 'recurring');
  assert.equal(checkPartOf({ cts: 1, type: 'Setup' }), 'setup');
  // A 6-month term puts all of it in year 1.
  const short = rateCardCheck({ items: [{ cts: 600, type: 'Setup Rolled' }], entry: twoComponents, meta: recurring, counts: { accounts: 519 }, termMonths: 6 });
  assert.equal(short.cost, 600);
});

test('a card with a setup fee is not setup-off-card', () => {
  const c = rateCardCheck({
    items: [{ cts: 100, type: 'Setup' }],
    entry: { basis: 'per_site', rate: 39, setupLines: [{ basis: 'flat', rate: 500 }] },
    meta: recurring,
    counts: { sites: 29 },
  });
  assert.equal(c.setupOffCard, false);
});

test('a one-time cost is checked against the card\'s setup lines, as the same part', () => {
  const c = rateCardCheck({
    items: [{ cts: 1000, type: 'One-time' }],
    entry: { basis: 'per_site', rate: 39, setupLines: [{ basis: 'flat', rate: 500, rateHigh: 5000 }] },
    meta: recurring,
    counts: { sites: 29 },
  });
  assert.deepEqual(c.parts.map(p => p.key), ['setup', 'recurring']);
  const setup = c.parts.find(p => p.key === 'setup');
  assert.equal(setup.status, RATE_CHECK.WITHIN);
  assert.equal(setup.cost, 1000);
  assert.ok(!c.parts.some(p => p.status === RATE_CHECK.NOT_ON_CARD));
});

test('fee rows bill on the count typed in the cost section', () => {
  const sia = { sites: 29, accounts: 40 };
  const typed = { counts: priceCheckCounts(sia, { sites_mandate: 22 }).counts, sia };
  // BBS prices on sites w/ mandate: its Per Site fee follows the 22 typed.
  assert.deepEqual(feeUnitCountsFor({ ...typed, rateCheck: { unitsUsed: ['sites_mandate'] } }), { siteCount: 22, accountCount: 40, kwhCount: undefined, dthCount: undefined });
  // A service that doesn't price on it keeps the SIA's sites.
  assert.deepEqual(feeUnitCountsFor({ ...typed, rateCheck: { unitsUsed: ['sites'] } }), { siteCount: 29, accountCount: 40, kwhCount: undefined, dthCount: undefined });
  // A typed override of the SIA's sites and accounts carries down too.
  const over = { counts: priceCheckCounts(sia, { sites: 31, accounts: 12 }).counts, sia, rateCheck: { unitsUsed: ['sites'] } };
  assert.deepEqual(feeUnitCountsFor(over), { siteCount: 31, accountCount: 12, kwhCount: undefined, dthCount: undefined });
  // Nothing typed: the SIA's.
  assert.deepEqual(feeUnitCountsFor({ counts: priceCheckCounts(sia, {}).counts, sia, rateCheck: { unitsUsed: ['sites_mandate'] } }), { siteCount: 29, accountCount: 40, kwhCount: undefined, dthCount: undefined });
});

test('a line takes its fee component from the unit of the structure fee it goes on', () => {
  const choices = { recurring: [{ id: 'recurring:recurring_annual', label: 'Recurring annual' }, { id: 'recurring:per_account', label: 'Per account' }] };
  const monthly = { cts: 100, type: 'Recurring (monthly)', startMonth: 1 };
  assert.equal(componentForFeeUnit(monthly, 'Per Account', choices), 'recurring:per_account');
  assert.equal(componentForFeeUnit(monthly, 'Fixed', choices), 'recurring:recurring_annual');
  assert.equal(componentForFeeUnit(monthly, 'Per Site', choices), null);
  assert.equal(componentForFeeUnit(monthly, '', choices), null);
  // A rolled setup is ongoing money, so it reads the ongoing components.
  assert.equal(componentForFeeUnit({ cts: 100, type: 'Setup Rolled', startMonth: 1 }, 'Fixed', choices), 'recurring:recurring_annual');
  // A part with one component has nothing to pick.
  assert.equal(componentForFeeUnit({ cts: 100, type: 'Setup', startMonth: 1 }, 'Per Account', choices), null);
  // Pass-through lines take the fee's model.
  assert.equal(componentForFeeUnit({ ...monthly, passThrough: true }, 'Per Account', choices), 'pass:per_account');
  assert.equal(componentForFeeUnit({ ...monthly, passThrough: true }, 'Fixed', choices), 'pass:fixed');
});


test('line counts: fee counts and the counts the range prices on', () => {
  assert.equal(lineFeeCounts({}), null);
  assert.deepEqual(lineFeeCounts({ accounts: 95, sites_mandate: 4, sites: 9 }), { accountCount: 95, siteCount: 4 });
  const counts = { accounts: 519, sites: 30 };
  assert.equal(priceCheckCountsWithLines(counts, [{ lineCounts: {} }]), counts);
  assert.deepEqual(priceCheckCountsWithLines(counts, [{ lineCounts: { accounts: 95 } }, { lineCounts: {} }]), { accounts: 519, sites: 30 });
  assert.deepEqual(priceCheckCountsWithLines(counts, [{ lineCounts: { accounts: 95 } }, { lineCounts: { accounts: 11 } }]), { accounts: 95, sites: 30 });
  assert.deepEqual(priceCheckCountsWithLines({}, [{ lineCounts: { meters: 40 } }]), { meters: 40 });
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');

test('lines starting after month 1 are judged over a full year, so the headline agrees with its components', () => {
  // Ongoing at $1,500 to $3,000 a year plus $10 to $15 per account a year,
  // every cost from month 4: year 1 bills nine months and would read low.
  const c = rateCardCheck({
    items: [
      { id: 'a', cts: 70, type: 'Recurring (monthly)', startMonth: 4, feeComponent: 'recurring:recurring_annual' },
      { id: 'b', cts: 240, type: 'Recurring (monthly)', startMonth: 4, feeComponent: 'recurring:per_account' },
    ],
    entry: { basis: 'recurring_annual', rate: 1500, rateHigh: 3000, lines: [{ basis: 'per_account', rate: 10, rateHigh: 15 }] },
    meta: recurring,
    counts: { accounts: 519 },
  });
  const { rows } = ongoingOf(c).components;
  assert.ok(rows.every(r => r.status === RATE_CHECK.WITHIN));
  assert.equal(c.low, 1500 + 10 * 519);
  // A full year: 310 x 12 x 2 = $7,440, within $6,690 to $10,785.
  assert.equal(c.price, 310 * 12 * 2);
  assert.equal(c.year1Price, 310 * 9 * 2);
  assert.equal(c.status, RATE_CHECK.WITHIN);
});

test('the headline is out of range when one component is, even if the total is not', () => {
  const c = rateCardCheck({
    items: [
      { id: 'a', cts: 40, type: 'Recurring (monthly)', feeComponent: 'recurring:recurring_annual' },
      { id: 'b', cts: 290, type: 'Recurring (monthly)', feeComponent: 'recurring:per_account' },
    ],
    entry: { basis: 'recurring_annual', rate: 1500, rateHigh: 3000, lines: [{ basis: 'per_account', rate: 10, rateHigh: 15 }] },
    meta: recurring,
    counts: { accounts: 519 },
  });
  // $960 a year is under $1,500; $6,960 over 519 accounts is $13.41, within.
  const [flat, perAccount] = ongoingOf(c).components.rows;
  assert.equal(flat.status, RATE_CHECK.BELOW);
  assert.equal(perAccount.status, RATE_CHECK.WITHIN);
  assert.equal(c.status, RATE_CHECK.BELOW);
});
