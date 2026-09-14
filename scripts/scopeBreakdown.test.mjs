// The ticked scope, broken down under the estimator bar.
//
// A panel that itemises a total has exactly one job beyond looking tidy:
// the parts have to add up to the whole. If they don't, it is worse than
// no panel at all - it invites somebody to check a figure and then tells
// them the figure is wrong.
//
// Two ways that goes quietly wrong here.
//
//   1. Setup. The estimator's Year 1 deal size is the fees PLUS every setup
//      fee, and the table's fee column is the fees alone. Print the fee
//      column and foot to the deal size and the panel is short by the setup
//      on every deal that has any.
//
//   2. The unpriced. A service the card cannot price is in the scope and
//      not in the total. Charging it at zero would foot, and would be a
//      lie: it is unknown, not free.
//
// Run: node scripts/scopeBreakdown.test.mjs
import { estimateScope, scopeYear1Lines, PRICING_BASES } from '../src/utils/servicePricing.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const bases = PRICING_BASES;
const recurring = { serviceType: 'recurring', years: 3 };
const rows = [
  { name: 'Bill payment', bucket: 'DATA', meta: recurring },
  { name: 'GHG reporting', bucket: 'GHG Reporting', meta: recurring },
  { name: 'Invoice variance testing', bucket: 'DATA', meta: recurring },
  { name: 'Bespoke consulting', bucket: 'DATA', meta: recurring },
];
const pricing = {
  // 100 sites x $400 = $40,000 a year, and $10,000 once to stand it up.
  'Bill payment': { basis: 'per_site', rate: 400, setupLines: [{ basis: 'flat', rate: 10000 }] },
  'GHG reporting': { basis: 'flat', rate: 60000 },
  'Invoice variance testing': { basis: 'per_site', rate: 10 },
  // Nothing on the card: in the deal, not in the total.
  'Bespoke consulting': {},
};
const counts = { sites: 100 };
const scope = ['Bill payment', 'GHG reporting', 'Invoice variance testing', 'Bespoke consulting'];
const estimate = estimateScope({ rows, services: scope, pricing, counts, bases });
const lines = scopeYear1Lines(estimate);

// ---- the parts add up to the whole ---------------------------------------
{
  const summed = lines.reduce((n, l) => n + (l.year1 || 0), 0);
  check('the breakdown foots to the deal size on the bar', summed, estimate.year1Total);
  const summedHigh = lines.reduce((n, l) => n + (l.year1High || 0), 0);
  check('at the top of the range too', summedHigh, estimate.year1TotalHigh);
}

// ---- setup rides inside the line -----------------------------------------
{
  const bill = lines.find(l => l.name === 'Bill payment');
  // $40,000 of fee and $10,000 of setup: what the account actually pays in
  // the first twelve months.
  check('a setup fee is carried inside the first year, not beside it', bill.year1, 50000);
  check('and the row says so', bill.setupNote, 'Includes $10,000 of setup, billed once');
  const ghg = lines.find(l => l.name === 'GHG reporting');
  check('a service with no setup says nothing', ghg.setupNote, '');
}

// ---- the unpriced are named, not charged at zero -------------------------
{
  const bespoke = lines.find(l => l.name === 'Bespoke consulting');
  check('a service the card cannot price is still in the panel', !!bespoke, true);
  check('with no figure on it', bespoke.year1, null);
  check('and no share of a deal it is not in', bespoke.share, '');
  check('so it sorts to the bottom', lines[lines.length - 1].name, 'Bespoke consulting');
}

// ---- biggest first, and the shares are of the deal -----------------------
{
  check('the biggest line leads', lines[0].name, 'GHG reporting');
  // And it leads on YEAR ONE including its setup: Bill payment's $40,000
  // fee is smaller than GHG's $60,000, but its $50,000 first year is what
  // the account pays and what the panel sorts on.
  check('then the next', lines[1].name, 'Bill payment');
  // $60,000 and $50,000 of a $111,000 first year.
  check('the share is of the whole deal', lines[0].share, '54%');
  check('and the second is of the same whole', lines[1].share, '45%');
  // $1,000 of $111,000 is nine tenths of a point, and rounds up rather
  // than reading as a service that costs nothing.
  check('a line under a point still shows a share', lines[2].share, '1%');
}

// ---- nothing ticked ------------------------------------------------------
{
  check('an empty scope has no breakdown', scopeYear1Lines({ lines: [], year1Total: 0 }).length, 0);
  check('and junk is not an estimate', scopeYear1Lines(null).length, 0);
}

console.log(`\n${failures ? `${failures} FAILED` : 'All passed'}`);
process.exit(failures ? 1 : 0);
