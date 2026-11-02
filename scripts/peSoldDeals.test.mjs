// Assertion tests for PE Portfolio > PE Sold. Plain Node. Run:
//   node scripts/peSoldDeals.test.mjs
//
// The rules worth pinning: only Source = PE partner counts (not Type), old
// sales stay in (this is a sales record, not a live list), the year chips
// narrow Sold but never Agreement Sent, and the dollar total says how many
// deals it covers.
import { peSoldBreakdown, isPeSourced, dealAmount } from '../src/utils/peSoldDeals.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const R = [
  { Account: 'A', Source: 'PE partner', Stage: 'Sold', 'Quoted Amount': '$10,000', 'Close Date': '2024-03-01' },
  { Account: 'B', Source: ' pe Partner ', Stage: 'Sold', 'Quoted Amount': '$5,000', 'Close Date': '2026-01-01' },
  { Account: 'C', Source: 'PE partner', Stage: 'Sold', 'Quoted Amount': '-', 'Close Date': '' },
  { Account: 'D', Source: 'PE partner', Stage: 'Agreement Sent', 'Quoted Amount': '$7,500', 'Start Date': '2026-09-01' },
  { Account: 'E', Source: 'PE partner', Stage: 'agreement sent', 'Start Date': '2026-10-01' },
  { Account: 'F', Source: 'Inside Sales', Type: 'Private Equity', Stage: 'Sold', 'Quoted Amount': '$99,000', 'Close Date': '2026-02-01' },
  { Account: 'G', Source: 'PE partner', Stage: 'Not Sold', 'Close Date': '2026-02-01' },
  { Account: 'H', Source: 'PE partner', Stage: 'Quoted' },
];

check('source match ignores case and spaces', [isPeSourced(R[1]), isPeSourced(R[5])], [true, false]);
check('placeholder amounts read as none', dealAmount(R[2]), null);

{
  const d = peSoldBreakdown(R);
  check('every PE-sourced sale, any age, newest first, undated last', d.sold.map(r => r.Account), ['B', 'A', 'C']);
  check('Type alone does not make a PE deal', d.sold.some(r => r.Account === 'F'), false);
  check('agreement sent, newest start first', d.agreementSent.map(r => r.Account), ['E', 'D']);
  check('sold total says how many were priced', d.soldTotals, { count: 3, amount: 15000, priced: 2 });
  check('agreement total', d.agreementTotals, { count: 2, amount: 7500, priced: 1 });
  check('close years for the chips, Jan 1 stays in its year', d.years, [2026, 2024]);
}

{
  const d = peSoldBreakdown(R, { years: [2026] });
  check('a year narrows Sold', d.sold.map(r => r.Account), ['B']);
  check('and reports the undated sale it left out', d.undatedSold, 1);
  check('but never Agreement Sent', d.agreementSent.length, 2);
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');
