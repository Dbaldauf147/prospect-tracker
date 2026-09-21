// A management fee is a cut of what it manages.
//
// Client management is priced as a percentage, and until now the only thing
// it could be a percentage OF on an opp was the amount being typed into the
// Deal Size box beside it. So a scope with eleven priced services in it and
// nothing typed yet showed "No deal to price on" against the one service
// whose deal was sitting right there on the screen: the other ten rows.
//
// What this pins, over estimateScope's percentOfScope pass:
//
//   1. The base is the REST of the scope - the year one fee of every other
//      priced service in it, at both ends of its range.
//   2. A percentage service is never part of its own base, and two of them
//      on one scope are both kept out of it: a cut of a figure that holds
//      the other cut has no answer.
//   3. "No deal to price on" survives exactly where it is true - the scope
//      with nothing in it to manage.
//   4. The typed deal size is the fallback for that case, not the answer
//      ahead of the scope.
//   5. Ticking a service out of the scope moves the base, because the base
//      is the scope.
//
// Run: node scripts/scopePercentOfScope.test.mjs
import { estimateScope, feeBasisLabel, scopeDealSizes, PRICING_BASES } from '../src/utils/servicePricing.js';

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
  { name: 'Client management', bucket: 'DATA', meta: recurring },
  { name: 'Strategic sourcing', bucket: 'DATA', meta: recurring },
  { name: 'Rate optimization', bucket: 'DATA', meta: recurring },
  { name: 'Budgets', bucket: 'DATA', meta: recurring },
  { name: 'Program oversight', bucket: 'DATA', meta: recurring },
];
const pricing = {
  // 100 sites at $400-$800 a site: $40,000-$80,000.
  'Bill payment': { basis: 'per_site', rate: 400, rateHigh: 800 },
  'Client management': { basis: 'pct_deal', rate: 10, rateHigh: 20 },
  // A flat $25,000-$35,000 on top.
  'Strategic sourcing': { basis: 'flat', rate: 25000, rateHigh: 35000 },
  // Given away on purpose: priced, and worth nothing towards the cut.
  'Rate optimization': { noFee: true },
  // Nobody has set a rate: unpriced, and worth nothing towards the cut.
  'Budgets': {},
  // A second cut of the same deal.
  'Program oversight': { basis: 'pct_deal', rate: 5 },
};
const counts = { sites: 100 };
const price = (services, dealSize = '') => estimateScope({
  rows, services, pricing, counts, bases, dealSize, percentOfScope: true,
});
const lineFor = (est, name) => est.lines.find(l => l.name === name);

// ---- the cut is of the rest of the scope ---------------------------------
{
  const est = price(['Bill payment', 'Client management', 'Strategic sourcing', 'Rate optimization', 'Budgets']);
  const cm = lineFor(est, 'Client management');
  // $40,000 + $25,000 = $65,000 at the bottom, $80,000 + $35,000 = $115,000
  // at the top. The no-fee service adds nothing and the unpriced one is not
  // counted at all.
  check('the low end is the rate on the low end of the rest', cm.fee, 6500);
  check('and the high end on the high end of it', cm.feeHigh, 23000);
  check('a priced cut has no note', cm.note, '');
  check('and no gap to chase', cm.gap, null);
  check('the estimate says what the cut was of', est.percentBases.get('Client management').low, 65000);
  check('at the top too', est.percentBases.get('Client management').high, 115000);
  // The total is the rest of the scope plus the cut taken out of it.
  check('the year one total carries the fee', est.year1Total, 65000 + 6500);
  check('at the top of the range as well', est.year1TotalHigh, 115000 + 23000);
}

// ---- the services being managed are priced exactly as they were ----------
{
  const services = ['Bill payment', 'Client management', 'Strategic sourcing'];
  const withCut = price(services);
  const plain = estimateScope({ rows, services, pricing, counts, bases });
  check('a per-site service is untouched by the pass', lineFor(withCut, 'Bill payment').fee,
    lineFor(plain, 'Bill payment').fee);
  check('and a flat one', lineFor(withCut, 'Strategic sourcing').feeHigh,
    lineFor(plain, 'Strategic sourcing').feeHigh);
  check('which is the only thing that moved', lineFor(plain, 'Client management').note,
    'No deal to price on');
}

// ---- two cuts, neither inside the other's base ---------------------------
{
  const est = price(['Bill payment', 'Client management', 'Program oversight']);
  check('both cuts are struck from the same $40,000', lineFor(est, 'Client management').fee, 4000);
  check('and the second is not a cut of the first', lineFor(est, 'Program oversight').fee, 2000);
  check('the base holds neither of them', est.percentBases.get('Program oversight').low, 40000);
}

// ---- nothing to manage ---------------------------------------------------
{
  const alone = price(['Client management']);
  check('a management fee on nothing says so', lineFor(alone, 'Client management').note,
    'No deal to price on');
  check('and reports the gap, so the bar can ask for a deal size',
    lineFor(alone, 'Client management').gap.kind, 'deal');
  check('with no base to report', alone.percentBases, null);

  // The scope is there but none of it has a price: same answer, because
  // there is still nothing for the fee to be a percentage of.
  const unpriced = price(['Client management', 'Budgets']);
  check('a scope with no money in it is the same case',
    lineFor(unpriced, 'Client management').note, 'No deal to price on');
  const free = price(['Client management', 'Rate optimization']);
  check('so is a scope given away for nothing',
    lineFor(free, 'Client management').note, 'No deal to price on');
}

// ---- the typed deal size is the fallback, not the answer -----------------
{
  const alone = price(['Client management'], '500000');
  check('alone, the cut is of the amount in the box', lineFor(alone, 'Client management').fee, 50000);
  const both = price(['Bill payment', 'Client management'], '500000');
  check('alongside a scope, the scope wins', lineFor(both, 'Client management').fee, 4000);
}

// ---- unticking a service moves the base ----------------------------------
{
  const all = price(['Bill payment', 'Client management', 'Strategic sourcing']);
  const fewer = price(['Client management', 'Strategic sourcing']);
  check('a service this deal is not charging for is not managed either',
    lineFor(fewer, 'Client management').fee, 2500);
  check('which is less than the whole scope came to',
    lineFor(all, 'Client management').fee > lineFor(fewer, 'Client management').fee, true);
}

// ---- a caller that already knows the deal keeps its answer ---------------
{
  const est = estimateScope({
    rows,
    services: ['Bill payment', 'Client management'],
    pricing,
    counts,
    bases,
    percentOfScope: true,
    // Account Potential works the bundle out for itself; the scope pass
    // must not overrule it.
    dealSizeByService: new Map([['Client management', { low: 1000, high: 2000 }]]),
  });
  check('a deal handed in beats the scope', lineFor(est, 'Client management').fee, 100);
  check('at the top as well', lineFor(est, 'Client management').feeHigh, 400);
}

// ---- the row says which deal it is a cut of ------------------------------
{
  const est = price(['Bill payment', 'Client management']);
  const cm = lineFor(est, 'Client management');
  check('left alone, a percentage reads as a cut of the deal size',
    feeBasisLabel(cm, bases), '10%–20% of deal size');
  check('told what it was struck from, it says that instead',
    feeBasisLabel(cm, bases, { percentOf: 'the rest of this scope' }),
    '10%–20% of the rest of this scope');
  check('a per-site line is unaffected by the phrase',
    feeBasisLabel(lineFor(est, 'Bill payment'), bases, { percentOf: 'the rest of this scope' }),
    '$400–$800 per site × 100');
}

// ---- the helper on its own ----------------------------------------------
{
  check('no lines, nothing to report', scopeDealSizes().size, 0);
  check('junk is tolerated', scopeDealSizes([null, undefined, {}]).size, 0);
  check('a scope with no percentage service has no base to work out',
    scopeDealSizes([{ name: 'A', priced: true, fee: 10, feeHigh: 20, breakdown: [{ kind: 'unit' }] }]).size, 0);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
