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
  assert.equal(row.gmLink.atCost, 3);
  assert.equal(row.gmLink.fixed, 1);
  // A monthly fee keeps its make-up per unit, for the escalators.
  assert.deepEqual(row.gmLink.esc, { feeFrom: 1, atCost: [['m', 1, 3]], fixed: [['m', 1, 1]] });
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
  assert.deepEqual(feeStructureRowToAltRow(filled.rows[0]).gmLink, filled.rows[0].gmLink);
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

test('a linked monthly fee re-prices when the escalators or term move', () => {
  const esc0 = { feeEscalator: 0, costEscalator: 0, termMonths: 36 };
  const { filled } = standardFeeContext(structure, costs, { termMonths: 36 });
  const link = filled.rows[0].gmLink;
  // Unchanged inputs give back the fee it was built at.
  assert.equal(feeAtGm(link, 0.5, esc0), 7);
  // Built with the escalators in: the same as re-pricing to them.
  const esc = { feeEscalator: 0.05, costEscalator: 0.0385, termMonths: 36 };
  const built = standardFeeContext(structure, costs, { termMonths: 36, ...esc }).filled.rows[0];
  assert.equal(feeAtGm(link, 0.5, esc), built.fee);
  assert.ok(built.fee < 7);
  // And back again from the escalated link.
  assert.equal(feeAtGm(built.gmLink, 0.5, esc0), 7);
  // A later start month on the row catches up the months before it.
  const late = standardFeeContext({ rows: [{ ...structure.rows[0], startMonth: 4 }] }, costs, { termMonths: 36, ...esc }).filled.rows[0];
  assert.equal(feeAtGm(link, 0.5, { ...esc, startMonth: 4 }), late.fee);
  // The schedule follows.
  const alt = { 1: [{ altItem: 'Per account', fee: 7, startMonth: 1, gmLink: link }] };
  assert.equal(repriceLinkedFees(alt, 0.5, esc)[1][0].fee, built.fee);
  assert.equal(repriceLinkedFees(alt, 0.5, esc0), alt);
  // An old link without the make-up still follows the GM only.
  assert.equal(feeAtGm({ atCost: 3, fixed: 1 }, 0.5, esc), 7);
});

test('a rolled cost on a monthly fee re-prices over the fee\'s months', () => {
  const rolled = [{ description: 'Build', type: 'Setup Rolled', startMonth: 1, feeName: 'Per account', price: 7200, priceAtCost: 3600, priceFixed: 0 }];
  const s1 = { rows: [{ ...structure.rows[0], unitCount: 1 }] };
  const esc = { feeEscalator: 0.05, costEscalator: 0.0385, termMonths: 36 };
  const link = standardFeeContext(s1, rolled, { termMonths: 36 }).filled.rows[0].gmLink;
  assert.equal(feeAtGm(link, 0.5, { feeEscalator: 0, costEscalator: 0, termMonths: 36 }), 200);
  assert.equal(feeAtGm(link, 0.5, esc), standardFeeContext(s1, rolled, { termMonths: 36, ...esc }).filled.rows[0].fee);
  assert.equal(feeAtGm(link, 0.5, { feeEscalator: 0, costEscalator: 0, termMonths: 24 }), 300);
});

test('without the split, no link', () => {
  const plain = costs.map(({ priceAtCost: _a, priceFixed: _b, ...c }) => c);
  const { filled } = standardFeeContext(structure, plain, { termMonths: 36 });
  assert.equal(filled.rows[0].fee, 7);
  assert.equal(filled.rows[0].gmLink, undefined);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
