// The opportunities half of Account Potential: what an account already has
// in flight, and what that does to the biggest deal left to sell them.
// Plain Node, no test framework (the project has none). Run:
//   node scripts/accountPotentialOppStages.test.mjs
//
// The company card states the biggest untapped deal in a field, and the
// Potential tab lists the same services in prize order. They are two runs
// of one function, so they agree on one condition: both are handed the same
// opportunities. Handed none, a page keeps the services already being
// quoted in the running and offers the biggest of them as the thing to go
// and sell - which is the account's own live pipeline, read back as new
// money. That is the failure these pin.
//
// The second half is which catalogue an opp's Scope is matched against. A
// service the user added to the board is not in the seed list, so matching
// against the seed alone leaves an opp naming it looking like it named
// nothing, and the service reads as never explored.
import { buildOppStagesByClient } from '../src/utils/serviceCoverage.js';
import { accountPotential } from '../src/utils/accountPotential.js';
import { PRICING_BASES } from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// An account with sites, so a per-site service is the biggest thing on the
// rate card - and an opp already quoting that very service.
const client = { company: 'Vibrantz', numberOfSites: 400, servicesExplored: {} };
const serviceRows = [
  { name: 'Bill payment', bucket: 'DATA', meta: { serviceType: 'recurring', years: 3 } },
  { name: 'GRESB fully managed', bucket: 'Investor Reporting', meta: { serviceType: 'recurring', years: 3 } },
  { name: 'Widget polishing', bucket: 'Bespoke', meta: { serviceType: 'recurring', years: 3 } },
];
const pricing = {
  'Bill payment': { basis: 'per_site', rate: 300 },
  'GRESB fully managed': { basis: 'flat', rate: 35000, rateHigh: 50000 },
  'Widget polishing': { basis: 'flat', rate: 90000 },
};
const opps = [
  { Account: 'Vibrantz', Scope: 'Bill payment', Stage: 'Quoted' },
  { Account: 'Somebody else', Scope: 'GRESB fully managed', Stage: 'Sold' },
];
const reading = (oppStages) => accountPotential({
  client, serviceRows, pricing, bases: PRICING_BASES,
  counts: { sites: 400 }, oppStages,
});

// ── What the opportunities rule out ───────────────────────────────────
{
  // 400 sites at $300 is $120,000: the biggest thing on this card, and
  // already quoted.
  const blind = reading(null);
  check('with no opportunities to read, the quoted service leads the page',
    blind.top.name, 'Bill payment');

  const stages = buildOppStagesByClient([client], opps, serviceRows.map(r => r.name)).get(client);
  check('the opp names the service it quotes', stages.get('Bill payment'), 'Quoted');
  // Another account's opp is another account's business.
  check('and nobody else\'s', stages.has('GRESB fully managed'), false);

  const seeing = reading(stages);
  check('reading them, it is out of the running',
    seeing.open.map(r => r.name), ['GRESB fully managed', 'Widget polishing']);
  check('and the biggest deal is the biggest thing NOT already in flight',
    seeing.top.name, 'Widget polishing');
  check('the quoted one is accounted for rather than dropped',
    seeing.decided.map(r => [r.name, r.status]), [['Bill payment', 'Quoted']]);
  // The page says why, and "in flight" is not "sold".
  check('counted as in flight', seeing.decidedCounts.inProgress, 1);
}

// ── Which catalogue the Scope is matched against ──────────────────────
{
  const custom = [{ Account: 'Vibrantz', Scope: 'Widget polishing', Stage: 'Verbal' }];
  const names = serviceRows.map(r => r.name);
  check('a service the user added to the board is matched when the caller names it',
    buildOppStagesByClient([client], custom, names).get(client)?.get('Widget polishing'), 'Verbal');
  // The seed list has never heard of it, so a caller that doesn't say which
  // catalogue it prices gets nothing back for that opp.
  check('and missed against the seed catalogue alone',
    buildOppStagesByClient([client], custom).has(client), false);
  // A built-in service is found either way: the default is still the seed
  // list every other caller relies on.
  check('a built-in service is found with no catalogue passed',
    buildOppStagesByClient([client], opps).get(client)?.get('Bill payment'), 'Quoted');
}

// ── The strongest signal wins ─────────────────────────────────────────
{
  const many = [
    { Account: 'Vibrantz', Scope: 'Bill payment', Stage: 'Not Sold' },
    { Account: 'Vibrantz', Scope: 'Bill payment', Stage: 'Sold' },
    { Account: 'Vibrantz', Scope: 'Bill payment', Stage: 'Lead' },
  ];
  check('sold beats a lead and a loss on the same service',
    buildOppStagesByClient([client], many, serviceRows.map(r => r.name)).get(client).get('Bill payment'),
    'Sold');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
