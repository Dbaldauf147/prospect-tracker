// The Pricing page's Services subtab price check: a service's SIA cost,
// marked up, against the range its Dropdowns rate card quotes.
// Plain Node, no test framework. Run:
//   node scripts/serviceRateCheck.test.mjs

import assert from 'node:assert/strict';
import { rateCardCheck, year1CostOf, RATE_CHECK, siaCountsFor, priceCheckCounts } from '../src/utils/serviceRateCheck.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const recurring = { serviceType: 'Recurring', years: '3 years' };
const project = { serviceType: 'Project', years: '1 year' };

test('recurring CTS counts twelve months, one-time once, pass-through not at all', () => {
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

test('marked up 50% and inside a per-site range', () => {
  const c = rateCardCheck({
    items: [{ cts: 1000, type: 'Recurring' }],
    entry: { basis: 'per_site', rate: 100, rateHigh: 200 },
    meta: recurring,
    counts: { sites: 100 },
  });
  assert.equal(c.cost, 12000);
  assert.equal(c.price, 18000);
  assert.equal(c.low, 10000);
  assert.equal(c.high, 20000);
  assert.equal(c.status, RATE_CHECK.WITHIN);
});

test('below and above the range', () => {
  const entry = { basis: 'flat', rate: 10000, rateHigh: 20000 };
  assert.equal(rateCardCheck({ items: [{ cts: 5000, type: 'One-time' }], entry, meta: project }).status, RATE_CHECK.BELOW);
  assert.equal(rateCardCheck({ items: [{ cts: 15000, type: 'One-time' }], entry, meta: project }).status, RATE_CHECK.ABOVE);
});

test('setup fee is part of the year 1 range', () => {
  const c = rateCardCheck({
    items: [{ cts: 10000, type: 'One-time' }],
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
    counts: { sites: 29, sites_mandate: 5 },
  });
  assert.equal(c.low, 500);
  assert.equal(c.status, RATE_CHECK.BELOW);
  assert.deepEqual(c.missing, []);
});

test('a percentage fee asks for, and prices on, a deal size', () => {
  const entry = { basis: 'pct_deal', rate: 10 };
  const before = rateCardCheck({ items: [{ cts: 100, type: 'One-time' }], entry, meta: project });
  assert.deepEqual(before.missing, [{ key: 'dealSize', label: 'Deal size' }]);
  const after = rateCardCheck({ items: [{ cts: 100, type: 'One-time' }], entry, meta: project, counts: { dealSize: 2000 } });
  assert.equal(after.low, 200);
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
  // Setup: 7,585.50 × 1.5 = 11,378.25 against 5,000 to 8,000.
  assert.equal(by.setup.status, RATE_CHECK.ABOVE);
  assert.equal(by.setup.low, 5000);
  assert.equal(by.setup.perUnit, null);
  // Ongoing, per account: 648.75 × 12 × 1.5 / 519 = 22.50 against $10 to $20.
  assert.equal(by.recurring.cost, 648.75 * 12);
  assert.equal(by.recurring.perUnit.unitLabel, 'Accounts');
  assert.ok(Math.abs(by.recurring.perUnit.price - 22.5) < 1e-9);
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
  assert.deepEqual(siaCountsFor(wb, o1), { sites: 29, accounts: 1, sitesFrom: 'Option 5', accountsFrom: 'Option 5' });
  assert.deepEqual(siaCountsFor(wb, o5), { sites: 29, accounts: 1, sitesFrom: null, accountsFrom: null });
  assert.deepEqual(siaCountsFor({ options: [o1] }, o1), { sites: null, accounts: null, sitesFrom: null, accountsFrom: null });
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

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
