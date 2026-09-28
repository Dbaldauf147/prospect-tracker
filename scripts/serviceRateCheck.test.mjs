// The Pricing page's Services subtab price check: a service's SIA cost,
// marked up, against the range its Dropdowns rate card quotes.
// Plain Node, no test framework. Run:
//   node scripts/serviceRateCheck.test.mjs

import assert from 'node:assert/strict';
import { rateCardCheck, year1CostOf, RATE_CHECK } from '../src/utils/serviceRateCheck.js';

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
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
