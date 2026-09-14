// Account Potential - what one company is still worth to us.
// Plain Node, no test framework (the project has none). Run:
//   node scripts/accountPotential.test.mjs
//
// The arithmetic is servicePricing.js's and is tested there. What is new
// here is a judgement, and it is the whole page: which services count as
// potential at all, and in what order they matter.
//
// Three ways that goes quietly wrong.
//
//   1. Counting money we already have. A service this company already buys
//      is not potential, and neither is one they turned down or one marked
//      N/A. Less obviously, nor is one sitting in a live opp - that money
//      is in the pipeline already, and a page that adds it to "untapped"
//      has counted it twice in the same review.
//
//   2. Missing money we do have. The status that rules a service out has to
//      be the company page's EFFECTIVE status - a manual entry, or failing
//      that whatever the account's opps imply. Reading only the manual map
//      leaves every service sold through an opp looking like whitespace,
//      which is the same page saying go and sell something we already sold.
//
//   3. Ranking on the wrong end of a range. A service quoted from nothing
//      up to half a million must not outrank one reliably worth four
//      hundred thousand. Rank on the low end or the top of the list fills
//      with whatever is least understood.
import {
  accountPotential, serviceDecision, splitByDecision, decidedCounts, rankByPotential,
} from '../src/utils/accountPotential.js';
import { PRICING_BASES } from '../src/utils/servicePricing.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const bases = PRICING_BASES;
// Recurring so a term multiplies it, which is what makes Est. Deal Value
// differ from Year 1 and the ranking mean something.
const recurring = { serviceType: 'recurring', years: 3 };
const row = (name, bucket = 'DATA', meta = recurring) => ({ name, bucket, meta });

const ROWS = [
  row('Bill payment'),
  row('Invoice recalculation'),
  row('GHG reporting', 'GHG Reporting'),
  row('Rate analysis'),
  row('Tariff review'),
];
const PRICING = {
  'Bill payment': { basis: 'per_site', rate: 100 },
  'Invoice recalculation': { basis: 'per_site', rate: 10 },
  'GHG reporting': { basis: 'flat', rate: 50000 },
  'Rate analysis': { basis: 'per_account', rate: 5 },
  // Nothing on the card at all: unpriceable, not worth nothing.
  'Tariff review': {},
};
const COUNTS = { sites: 100, accounts: 1000 };
const run = (client, oppStages = null) => accountPotential({
  client, serviceRows: ROWS, pricing: PRICING, bases, counts: COUNTS, oppStages,
});

// ---- nothing decided yet -------------------------------------------------
{
  const p = run({ company: 'Acme', servicesExplored: {} });
  check('with a clean card every service is potential', p.open.length, 5);
  check('and nothing is ruled out', p.decided.length, 0);
  // Over the three-year term: GHG $50k a year is $150k, Bill payment
  // 100 sites x $100 is $30k, Rate analysis 1000 accounts x $5 is $15k,
  // Invoice recalculation 100 sites x $10 is $3k. Note the order is NOT
  // the order of the rate cards - a $100 rate on a hundred sites loses to
  // a flat fee - which is the reason the page ranks rather than lists.
  check('the biggest prize leads', p.ranked[0].name, 'GHG reporting');
  check('then the next', p.ranked[1].name, 'Bill payment');
  check('then the next', p.ranked[2].name, 'Rate analysis');
  check('then the smallest priced one', p.ranked[3].name, 'Invoice recalculation');
  // Not worth nothing - unknown, and the difference is the reason to go
  // and price it.
  check('a service the card cannot price sorts last', p.ranked[4].name, 'Tariff review');
  check('rather than being ranked at zero', p.rank.get('Tariff review'), null);
  check('the rank is a position, not an index', p.rank.get('GHG reporting'), 1);
  check('and it follows the money, not the catalogue', p.rank.get('Bill payment'), 2);
  // The one line worth reading out in a pipeline review, stated rather
  // than left as "whatever is at the top of the list".
  check('the biggest single deal is named', p.top.name, 'GHG reporting');
  check('with what it is worth', p.top.value, 150000);
  check('the whole prize is the contract value', p.estimate.contractValue,
    (100 * 100 * 3) + 50000 * 3 + (1000 * 5 * 3) + (100 * 10 * 3));
}

// ---- a card that has ruled on things -------------------------------------
{
  const client = {
    company: 'Acme',
    servicesExplored: {
      'Bill payment': 'Sold',
      'GHG reporting': 'Not Sold',
      'Rate analysis': 'N/A',
      'Invoice recalculation': 'Quoting',
      'Tariff review': '-',
    },
  };
  const p = run(client);
  check('a service they already buy is not potential', p.decidedNames.has('Bill payment'), true);
  check('nor one they turned down', p.decidedNames.has('GHG reporting'), true);
  check('nor one marked not applicable', p.decidedNames.has('Rate analysis'), true);
  // The money in a live opp is in the pipeline already. Counting it here
  // too is counting it twice in the same review.
  check('nor one already in flight', p.decidedNames.has('Invoice recalculation'), true);
  // A dash is the card's way of writing "no status", not a status called
  // "-". Reading it as one would empty the page on a card somebody had
  // opened and closed.
  check('a dash is no status, so the service stays potential',
    p.open.map(r => r.name).join(','), 'Tariff review');
  check('and the totals hold only what is left', p.estimate.contractValue, 0);
  const c = p.decidedCounts;
  check('the decided are counted by outcome',
    `${c.sold}/${c.inProgress}/${c.notSold}/${c.na}`, '1/1/1/1');
}

// ---- status the company page would show, not just the manual map ---------
// A service sold through an opportunity carries no manual status at all.
// Reading only servicesExplored leaves it looking like whitespace, and the
// page then says go and sell something we already sold.
{
  const client = { company: 'Acme', servicesExplored: {} };
  const stages = new Map([['Bill payment', 'Sold'], ['GHG reporting', 'Qualifying']]);
  const p = run(client, stages);
  check('a service sold through an opp drops out too', p.decidedNames.has('Bill payment'), true);
  check('and one in flight through an opp as well', p.decidedNames.has('GHG reporting'), true);
  check('leaving the rest', p.open.length, 3);

  // A manual entry is an explicit override and beats the opp.
  const overridden = run(
    { company: 'Acme', servicesExplored: { 'Bill payment': '-' } },
    new Map([['Bill payment', 'Sold']]),
  );
  check('a dash does not override an opp that says Sold',
    overridden.decidedNames.has('Bill payment'), true);
  const revived = run(
    { company: 'Acme', servicesExplored: { 'Bill payment': 'Exploring' } },
    new Map([['Bill payment', 'Sold']]),
  );
  check('but a real manual status wins, and Exploring is still decided',
    revived.decidedNames.has('Bill payment'), true);
}

// ---- ranking on the low end ----------------------------------------------
// A range is an admission of uncertainty. Rank on its top and the head of
// the list fills with whatever we understand least.
{
  const ranked = rankByPotential([
    { name: 'Wide guess', priced: true, value: 0, valueHigh: 500000, fee: 0 },
    { name: 'Known quantity', priced: true, value: 400000, valueHigh: 400000, fee: 400000 },
  ]);
  check('a wide guess does not outrank a known quantity', ranked[0].name, 'Known quantity');

  const tied = rankByPotential([
    { name: 'B', priced: true, value: 100, valueHigh: 100, fee: 100 },
    { name: 'A', priced: true, value: 100, valueHigh: 900, fee: 100 },
  ]);
  check('the top of the range breaks a tie', tied[0].name, 'A');

  const sameBoth = rankByPotential([
    { name: 'Zeta', priced: true, value: 1, valueHigh: 1, fee: 1 },
    { name: 'Alpha', priced: true, value: 1, valueHigh: 1, fee: 1 },
  ]);
  check('and the name settles it, so two runs rank the same',
    sameBoth.map(l => l.name).join(','), 'Alpha,Zeta');
}

// ---- nothing the card can price ------------------------------------------
// The unpriced sort to the bottom, so the top of the list on a book with
// no rates at all is still an unpriced service. Naming that as the biggest
// deal on the account would be a claim nothing supports.
{
  const p = accountPotential({
    client: { company: 'Acme', servicesExplored: {} },
    serviceRows: [row('Tariff review'), row('Bespoke consulting')],
    pricing: {}, bases, counts: COUNTS,
  });
  check('with nothing priced there is no biggest deal', p.top, null);
  check('though the services are still listed', p.open.length, 2);
}

// ---- nothing left at all -------------------------------------------------
{
  const p = accountPotential({
    client: { company: 'Acme', servicesExplored: { 'Bill payment': 'Sold' } },
    serviceRows: [row('Bill payment')],
    pricing: PRICING, bases, counts: COUNTS,
  });
  check('an account with nothing open has no biggest deal', p.top, null);
  check('and nothing to list', p.open.length, 0);
}

// ---- no company picked ---------------------------------------------------
// The page before anybody has typed a name: the whole catalogue, nothing
// ruled out, which is the Deal Pricing behaviour this grew out of.
{
  const p = run(null);
  check('with no company every service is still listed', p.open.length, 5);
  check('and nothing is ruled out', p.decided.length, 0);
}

// ---- the two buckets are different things --------------------------------
// A row carries a `bucket` (the service bucket it is filed under) and a
// decision carries a status bucket. One silently overwriting the other
// prices the page wrong without ever looking wrong.
{
  const { open } = splitByDecision({ company: 'Acme', servicesExplored: {} }, ROWS);
  const ghg = open.find(r => r.name === 'GHG reporting');
  check('the service bucket survives the split', ghg.bucket, 'GHG Reporting');
  check('and the status bucket sits beside it', ghg.statusBucket, 'none');
}

// ---- the pieces on their own ---------------------------------------------
{
  const d = serviceDecision({ servicesExplored: { X: 'Sold' } }, 'X');
  check('a decision names the status it found', d.status, 'Sold');
  check('and the bucket it falls in', d.statusBucket, 'sold');
  check('an unknown service is undecided', serviceDecision({}, 'Y').decided, false);
  check('counting ignores a bucket it does not know',
    decidedCounts([{ statusBucket: 'nonsense' }]).sold, 0);
}

console.log(`\n${failures ? `${failures} FAILED` : 'All passed'}`);
process.exit(failures ? 1 : 0);
