// Fees the Fee Builder writes follow the Pricing page's Global GM%.
// Plain Node, no test framework. Run:
//   node scripts/gmLinkedFees.test.mjs
//
// What has to hold:
//   1. A blank structure fee filled by the standard fee carries a gmLink
//      splitting it into the part marked up at the Global GM% and the part
//      priced some other way (pass-through here).
//   2. feeAtGm at the GM it was built at gives back the fee it was built
//      with, and a new GM re-prices only the marked-up part.
//   3. repriceLinkedFees moves linked rows only, and hands back the same
//      object when nothing changes.
//   4. A typed fee is left alone and carries no link.

import assert from 'node:assert/strict';
import {
  standardFeeContext, feeAtGm, repriceLinkedFees, feeStructureRowToAltRow,
} from '../src/utils/pricingServices.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const gm = 0.5;
// Two monthly costs on one per-account fee: $300 marked up at 50% ($600),
// and a $100 pass-through billed at cost.
const costs = [
  { description: 'Ongoing', type: 'Recurring (monthly)', startMonth: 1, feeName: 'Per account', price: 300 / (1 - gm), priceAtCost: 300, priceFixed: 0 },
  { description: 'Postage', type: 'Recurring (monthly)', startMonth: 1, feeName: 'Per account', price: 100, priceAtCost: 0, priceFixed: 100 },
];
const structure = {
  rows: [
    { feeName: 'Per account', type: 'Recurring (monthly)', fee: null, unit: 'Per Account', unitCount: 100, startMonth: 1 },
    { feeName: 'Setup', type: 'Setup', fee: 250, unit: 'Fixed', unitCount: 1, startMonth: 1 },
  ],
};

test('a filled fee carries its split', () => {
  const { filled } = standardFeeContext(structure, costs, { termMonths: 36 });
  const row = filled.rows[0];
  assert.equal(row.fee, 7);
  assert.deepEqual(row.gmLink, { atCost: 3, fixed: 1 });
  assert.equal(filled.rows[1].gmLink, undefined);
  assert.equal(filled.rows[1].fee, 250);
});

test('feeAtGm reproduces and re-prices', () => {
  const link = { atCost: 3, fixed: 1 };
  assert.equal(feeAtGm(link, 0.5), 7);
  assert.equal(feeAtGm(link, 0.4), 6);
  assert.equal(feeAtGm(link, 1), null);
});

test('the link survives onto the schedule row', () => {
  const { filled } = standardFeeContext(structure, costs, { termMonths: 36 });
  assert.deepEqual(feeStructureRowToAltRow(filled.rows[0]).gmLink, { atCost: 3, fixed: 1 });
});

test('repriceLinkedFees moves linked rows only', () => {
  const typed = { altItem: 'Setup', fee: 250 };
  const linked = { altItem: 'Per account', fee: 7, gmLink: { atCost: 3, fixed: 1 } };
  const alt = { 1: [typed, linked] };
  const next = repriceLinkedFees(alt, 0.4);
  assert.equal(next[1][0], typed);
  assert.equal(next[1][1].fee, 6);
  assert.equal(repriceLinkedFees(alt, 0.5), alt);
});

test('without the split, no link', () => {
  const plain = costs.map(({ priceAtCost: _a, priceFixed: _b, ...c }) => c);
  const { filled } = standardFeeContext(structure, plain, { termMonths: 36 });
  assert.equal(filled.rows[0].fee, 7);
  assert.equal(filled.rows[0].gmLink, undefined);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
