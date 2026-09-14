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
  bundleAutoAdds, bundleTotals,
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

// ---- services that come with other services ------------------------------
// Some services are never sold alone, and the Services tab records that in
// an Auto-add cell. A page ranking what an account is worth has to price
// the BUNDLE, because the bundle is what gets sold - a lead quoted on its
// own is quoted short by whatever comes with it.
//
// The whole difficulty is counting each service exactly once. Two leads can
// name the same add-on, chains run several deep, and two services can name
// each other. Every one of those is a way for a total to quietly exceed the
// sum of its parts.
{
  const CLIENT = { company: 'Acme', servicesExplored: {} };
  const bundled = (overrides, rows = ROWS, client = CLIENT) => accountPotential({
    client, serviceRows: rows, pricing: PRICING, bases, counts: COUNTS, overrides,
  });
  // Bill payment ($30k over the term) pulls in Invoice recalculation ($3k).
  const overrides = { 'Bill payment': { autoAdd: 'Invoice recalculation' } };
  const p = bundled(overrides);
  const bill = p.bundleOf.get('Bill payment');
  check('the lead carries its add-on', bill.adds.map(a => a.name).join(','), 'Invoice recalculation');
  check('and the add-on is not a row of its own', p.bundledNames.has('Invoice recalculation'), true);
  check('the lead is still one', p.bundleOf.has('Invoice recalculation'), false);
  // 100 sites x $100 x 3 plus 100 sites x $10 x 3.
  check('the bundle is worth both of them', bill.totals.value, 33000);
  check('and its Year 1 fee is both of them', bill.totals.fee, 11000);

  // The sum over the page still has to be the sum over the services. A
  // bundle is a way of ARRANGING the money, never of adding to it.
  const pageTotal = p.bundles.reduce((n, b) => n + b.totals.value, 0);
  check('rearranging the money does not create any',
    pageTotal, p.estimate.contractValue);

  // Two leads naming the same add-on. Whoever gets it, it is counted once.
  const shared = bundled({
    'Bill payment': { autoAdd: 'Invoice recalculation' },
    'GHG reporting': { autoAdd: 'Invoice recalculation' },
  });
  const holders = shared.bundles.filter(b => b.adds.some(a => a.open && a.name === 'Invoice recalculation'));
  check('an add-on two leads both want goes to exactly one', holders.length, 1);
  // GHG reporting is the bigger service ($50k a year against $10k), and the
  // bigger service is the one it is most likely being sold with.
  check('and it is the bigger of the two', holders[0].lead.name, 'GHG reporting');
  check('the page still foots',
    shared.bundles.reduce((n, b) => n + b.totals.value, 0), shared.estimate.contractValue);

  // A chain. A pulls B, B pulls C: the lead ends up with both.
  const chain = bundled({
    'GHG reporting': { autoAdd: 'Bill payment' },
    'Bill payment': { autoAdd: 'Invoice recalculation' },
  });
  const ghg = chain.bundleOf.get('GHG reporting');
  check('a chain collapses into the one lead',
    ghg.adds.map(a => a.name).sort().join(','), 'Bill payment,Invoice recalculation');
  check('and still foots',
    chain.bundles.reduce((n, b) => n + b.totals.value, 0), chain.estimate.contractValue);

  // Two services naming each other. Taking "whoever names it" literally
  // leaves both as somebody's add-on and neither as a lead, and the page
  // loses them both.
  const cycle = bundled({
    'Bill payment': { autoAdd: 'GHG reporting' },
    'GHG reporting': { autoAdd: 'Bill payment' },
  });
  check('a cycle still produces a lead',
    cycle.bundles.some(b => b.lead.name === 'GHG reporting'), true);
  check('with the other inside it', cycle.bundledNames.has('Bill payment'), true);
  check('and nothing is lost',
    cycle.bundles.reduce((n, b) => n + b.totals.value, 0), cycle.estimate.contractValue);

  // An add-on the account has already ruled on comes with the sale but is
  // not new money: selling them Bill payment does not win Invoice
  // recalculation again if they already buy it.
  const owned = bundled(
    { 'Bill payment': { autoAdd: 'Invoice recalculation' } },
    ROWS,
    { company: 'Acme', servicesExplored: { 'Invoice recalculation': 'Sold' } },
  );
  const b2 = owned.bundleOf.get('Bill payment');
  check('an add-on they already buy is still named', b2.adds[0].name, 'Invoice recalculation');
  check('but marked as not open', b2.adds[0].open, false);
  check('and its money is not counted again', b2.totals.value, 30000);

  // The ranking runs on the bundle, not the lead: a modest service that
  // drags in a big one is the bigger sale, and should read as one.
  const lifted = bundled({ 'Invoice recalculation': { autoAdd: 'GHG reporting' } });
  check('a lead is ranked on what it brings with it',
    lifted.rank.get('Invoice recalculation'), 1);
  check('and the biggest deal is the bundle', lifted.top.name, 'Invoice recalculation');
  check('worth the two together', lifted.top.value, 153000);
}

// ---- bundling with nothing to bundle -------------------------------------
{
  const plain = accountPotential({
    client: { company: 'Acme', servicesExplored: {} },
    serviceRows: ROWS, pricing: PRICING, bases, counts: COUNTS,
  });
  check('with no overrides every service leads its own row', plain.bundles.length, ROWS.length);
  check('and nothing is bundled away', plain.bundledNames.size, 0);
  check('a lead with no add-ons totals to itself',
    plain.bundleOf.get('GHG reporting').totals.value, 150000);
}

// ---- a lead with no rate that brings services that have one --------------
// Reporting the bundle as unpriced because its lead is would lose the two
// services hanging off it.
{
  const p = accountPotential({
    client: { company: 'Acme', servicesExplored: {} },
    serviceRows: [row('Tariff review'), row('GHG reporting', 'GHG Reporting')],
    pricing: PRICING, bases, counts: COUNTS,
    overrides: { 'Tariff review': { autoAdd: 'GHG reporting' } },
  });
  const lead = p.bundles.find(b => b.lead.name === 'Tariff review');
  // GHG reporting is the bigger service so it leads; the unpriced one is
  // what hangs off it. Either way the money survives.
  check('the money survives an unpriced service either way',
    p.bundles.reduce((n, b) => n + b.totals.value, 0), 150000);
  if (lead) check('and a bundle led by an unpriced service is still priced', lead.totals.priced, true);
  else check('the priced service leads instead', p.bundleOf.has('GHG reporting'), true);
}

// ---- the pieces on their own ---------------------------------------------
{
  const totals = bundleTotals({
    lead: { name: 'A', priced: true, fee: 10, feeHigh: 20, value: 30, valueHigh: 40 },
    adds: [
      { name: 'B', open: true, line: { priced: true, fee: 1, feeHigh: 2, value: 3, valueHigh: 4 } },
      { name: 'C', open: false, line: null },
    ],
  });
  check('a bundle adds up its open parts', `${totals.fee}/${totals.value}`, '11/33');
  check('at the top of the range too', `${totals.feeHigh}/${totals.valueHigh}`, '22/44');
  check('it counts what it names', totals.addCount, 2);
  check('and what it charges for', totals.openAddCount, 1);
  check('no lines, no bundles', bundleAutoAdds([], null).length, 0);
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
