// Assertion tests for the Close Rates date basis (byDateBasis in
// src/utils/closeRateDeepDive.js). Plain Node. Run:
//   node scripts/closeRateDateBasis.test.mjs
//
// "By Open Date" puts each closed deal in the period it opened (its Start
// Date) instead of the period it closed, for every close-rate chart, while
// the exports keep printing the real Close Date.

import assert from 'node:assert/strict';
import { byDateBasis, CLOSE_DATE_ACTUAL, stageCloseRateTrend, closedOppSheetRows } from '../src/utils/closeRateDeepDive.js';
import { closeRateTrend } from '../src/utils/notSoldAnalysis.js';

const opps = [
  // Opened in Q1 2025, both closed in Q3 2025.
  { Account: 'A', Source: 'Partner', Stage: 'Sold', 'Start Date': '2025-02-10', 'Close Date': '2025-08-01' },
  { Account: 'B', Source: 'Partner', Stage: 'Not Sold', 'Start Date': '2025-03-05', 'Close Date': '2025-09-15' },
  // Opened and closed in Q3 2025.
  { Account: 'C', Source: 'Partner', Stage: 'Not Sold', 'Start Date': '2025-07-02', 'Close Date': '2025-07-30' },
  // Open: untouched either way.
  { Account: 'D', Source: 'Partner', Stage: 'Quoted', 'Start Date': '2025-01-01', 'Close Date': '' },
];

// Close Date basis is the records as they are.
assert.equal(byDateBasis(opps, 'close'), opps);

const open = byDateBasis(opps, 'open');
assert.equal(open[0]['Close Date'], '2025-02-10');
assert.equal(open[0][CLOSE_DATE_ACTUAL], '2025-08-01');
assert.equal(open[3], opps[3]); // open opp not copied
assert.equal(opps[0]['Close Date'], '2025-08-01'); // originals untouched

// Close Date: all three in Q3 2025, 1 of 3 won.
const byClose = closeRateTrend(opps, { period: 'quarter' });
assert.deepEqual(byClose.periods, ['2025-Q3']);
assert.equal(byClose.overall['2025-Q3'].decided, 3);
assert.equal(byClose.overall['2025-Q3'].wins, 1);

// Open Date: Q1 2025 has A and B (1 of 2 won), Q3 has C (0 of 1).
const byOpen = closeRateTrend(open, { period: 'quarter' });
assert.equal(byOpen.overall['2025-Q1'].decided, 2);
assert.equal(byOpen.overall['2025-Q1'].wins, 1);
assert.equal(byOpen.overall['2025-Q3'].decided, 1);
assert.equal(byOpen.overall['2025-Q3'].wins, 0);

// The window follows the basis: from July on, Open Date keeps only C.
assert.equal(closeRateTrend(open, { period: 'quarter', from: '2025-07-01' }).decided, 1);
assert.equal(closeRateTrend(opps, { period: 'quarter', from: '2025-07-01' }).decided, 3);

// The stage chart goes the same way.
const stageOpen = stageCloseRateTrend(open, { period: 'quarter', includePullThroughs: true });
assert.ok(stageOpen.periods.includes('2025-Q1'));

// The closed-opps export prints the real Close Date and the Start Date.
const rows = closedOppSheetRows(open, { period: 'quarter', includePullThroughs: true });
const a = rows.find(r => r.Account === 'A');
assert.equal(a['Close Date'], '2025-08-01');
assert.equal(a['Start Date'], '2025-02-10');
assert.equal(a.Period, 'Q1 2025');

// A closed deal with no Start Date drops out as undated on Open Date.
const noStart = byDateBasis([{ Stage: 'Sold', 'Start Date': '', 'Close Date': '2025-08-01' }], 'open');
assert.equal(closeRateTrend(noStart, { period: 'quarter' }).decided, 0);

console.log('closeRateDateBasis: ok');
