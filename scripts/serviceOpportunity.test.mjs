// Assertion tests for the Service Opportunity roll-up — what one service is
// worth across the whole book of clients.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/serviceOpportunity.test.mjs
//
// What's worth pinning down is which clients land in the headline. The rule
// is Deal Sizing's own, applied per service rather than per scope: a client
// the company card has already ruled on — sold it, lost it, has it in flight,
// marked it N/A — is not open upside, and its money belongs in the separate
// whole-book figure rather than in the number a quarter gets planned off.
// Getting that wrong is quiet: the table still ranks, it just ranks the
// services the book already buys to the top.
//
// The other half is the counts. A service priced per site has to reach for
// the client's OWN site count, and a count typed against that client on the
// sizing page has to beat the portfolio figure — the same precedence
// clientDealSizing applies, since these are the same estimates.
import {
  rollUpServiceOpportunity,
  rollUpOpportunityTotals,
  exploredSummary,
} from '../src/utils/serviceOpportunity.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// ---- Fixtures -------------------------------------------------------------
// One per-site recurring service and one flat project, so both halves of the
// estimator are exercised: an annual fee multiplied by a term, and a one-off.
const bases = [
  { key: 'per_site', label: 'Per site', kind: 'unit', unit: 'sites', unitLabel: 'Sites' },
  { key: 'flat', label: 'Flat fee', kind: 'flat' },
  { key: 'pct_deal', label: '% of deal size', kind: 'percent' },
];

const serviceRows = [
  { name: 'Bill Pay', bucket: 'Billing', meta: { serviceType: 'Recurring', years: 3 } },
  { name: 'Audit', bucket: 'Advisory', meta: { serviceType: 'Project', years: 1 } },
  { name: 'Unpriced Thing', bucket: 'Advisory', meta: { serviceType: 'Project', years: 1 } },
];

const pricing = {
  'Bill Pay': { basis: 'per_site', rate: 100, rateHigh: 200 },
  Audit: { basis: 'flat', rate: 5000 },
  // 'Unpriced Thing' deliberately absent: no rate on the card.
};

// Four clients. Two open on Bill Pay, one already sold it, one has it in
// flight — so the headline is the two open ones and the book figure is all four.
const clients = [
  { company: 'Alpha', numberOfSites: 10, servicesExplored: {} },
  { company: 'Beta', numberOfSites: 5, servicesExplored: {} },
  { company: 'Gamma', numberOfSites: 100, servicesExplored: { 'Bill Pay': 'Sold' } },
  { company: 'Delta', numberOfSites: 50, servicesExplored: { 'Bill Pay': 'Proposal' } },
];

const scopes = {};
const scopeOf = (c) => scopes[c.company];

const roll = (over = {}) => rollUpServiceOpportunity({
  clients, serviceRows, pricing, bases, scopeOf, ...over,
});
const byName = (rows, name) => rows.find(r => r.name === name);

// ---- The headline is the open clients -------------------------------------
// Bill Pay: $100/site/yr over 3 years. Alpha 10 sites = $3,000, Beta 5 = $1,500.
let rows = roll();
let billPay = byName(rows, 'Bill Pay');
check('open clients are the ones the card says nothing about', billPay.openClients, 2);
check('the headline prices only those', billPay.contractValue, 4_500);
check('and carries the top of the rate range', billPay.contractValueHigh, 9_000);
check('Year 1 is one year of the annual fee', billPay.year1, 1_500);
check('recurring is the annual fee', billPay.recurringAnnual, 1_500);

// Gamma (100 sites = $30,000) and Delta (50 = $15,000) are ruled on, so their
// money is reported as book value and never as upside.
check('the whole book counts every client', billPay.bookValue, 49_500);
check('sold clients are counted as sold', billPay.statuses.sold, 1);
check('an in-flight status is not open', billPay.statuses.inProgress, 1);
check('open clients are counted as none', billPay.statuses.none, 2);

// ---- A flat service prices the same for every open client -----------------
const audit = byName(rows, 'Audit');
check('a flat project prices per client regardless of size', audit.contractValue, 20_000);
check('a project has no recurring half', audit.recurringAnnual, 0);
check('nobody has ruled on it, so every client is open', audit.openClients, 4);

// ---- An unpriced service is reported, not silently zeroed -----------------
const unpriced = byName(rows, 'Unpriced Thing');
check('a service with no rate on the card is flagged unpriced', unpriced.priced, false);
check('and contributes nothing', unpriced.contractValue, 0);
check('a service with a rate is not flagged', billPay.priced, true);

// ---- Count precedence: typed beats the company record ---------------------
// The same precedence clientDealSizing applies, because these are its estimates.
scopes.Alpha = { counts: { sites: 1 } };
rows = roll();
billPay = byName(rows, 'Bill Pay');
check('a count typed against the client beats the portfolio figure',
  billPay.contractValue, 1_800); // Alpha 1 site = $300, Beta 5 = $1,500
delete scopes.Alpha;

// ---- A per-service unit count beats both ----------------------------------
scopes.Beta = { serviceUnits: { 'Bill Pay': 2 } };
rows = roll();
billPay = byName(rows, 'Bill Pay');
check('a unit count typed against the service wins',
  billPay.contractValue, 3_600); // Alpha 10 = $3,000, Beta 2 sites = $600
delete scopes.Beta;

// ---- A client with no count is named, not left as a bare zero -------------
const noCounts = [{ company: 'Epsilon', servicesExplored: {} }];
const thin = rollUpServiceOpportunity({
  clients: noCounts, serviceRows, pricing, bases, scopeOf: () => null,
});
const thinBillPay = byName(thin, 'Bill Pay');
check('a client with no site count prices at nothing', thinBillPay.contractValue, 0);
check('and says which count it was missing',
  thinBillPay.clients[0].missingUnits.join(','), 'sites');
check('so it is not counted as a priced client', thinBillPay.pricedClients, 0);

// ---- Opp-derived statuses count as explored -------------------------------
// A service sold through an opportunity's Scope is what makes the company
// card read Sold for it; reading only the hand-set map would size work the
// client demonstrably already buys.
const stages = new Map([[clients[0], new Map([['Audit', 'Sold']])]]);
rows = roll({ oppStagesByClient: stages });
check('a status derived from an opp closes the client off',
  byName(rows, 'Audit').openClients, 3);
check('and is counted as sold', byName(rows, 'Audit').statuses.sold, 1);

// ---- Per-client detail ----------------------------------------------------
rows = roll();
billPay = byName(rows, 'Bill Pay');
check('every client appears in the detail, ruled-on ones included',
  billPay.clients.length, 4);
check('biggest first', billPay.clients[0].company, 'Gamma');
check('and each says whether it is open', billPay.clients[0].open, false);

// ---- Totals ---------------------------------------------------------------
const totals = rollUpOpportunityTotals(rows);
check('totals add the services up', totals.contractValue, 24_500);
check('and count the ones carrying upside', totals.withValue, 2);
check('and the ones with no rate at all', totals.unpriced, 1);
check('every row is counted as a service', totals.services, 3);

// ---- Which clients hold the counts the service is priced on ---------------
// The money column cannot tell "this client is worth nothing on it" from
// "nobody has entered their site count", and the two call for opposite
// responses. So the counts a service reaches for, and how much of the book
// holds them, are tallied separately.
{
  // A fifth client with no site count at all: open on everything, priceable
  // on nothing that charges per site.
  const withBlank = [...clients, { company: 'Epsilon', servicesExplored: {} }];
  const r = rollUpServiceOpportunity({ clients: withBlank, serviceRows, pricing, bases, scopeOf });

  const bp = byName(r, 'Bill Pay');
  check('a per-site service says it reaches for the site count',
    bp.unitsNeeded.join(','), 'sites');
  check('named the way the rate card names it', bp.unitLabels.join(','), 'Sites');
  check('four of the five clients have one', bp.clientsWithUnits, 4);
  check('and the client without is the one missing it',
    bp.clients.find(c => c.company === 'Epsilon').missingUnitLabels.join(','), 'Sites');
  check('a client who has it is missing nothing',
    bp.clients.find(c => c.company === 'Alpha').missingUnits.length, 0);
  // Open clients are tracked apart: they are the ones worth chasing the
  // number for, since a sold client's missing count changes no upside.
  check('the open clients are counted on their own', bp.openClients, 3);
  check('two of the three open ones can be priced', bp.openClientsWithUnits, 2);

  // A flat fee asks for nothing, and must not be reported as a book with
  // perfect data — there is no data standing in its way at all.
  const flat = byName(r, 'Audit');
  check('a flat fee reaches for no count', flat.unitsNeeded.length, 0);
  check('so it has no labels to name', flat.unitLabels.length, 0);

  // A count typed against the client for that one service answers the
  // question on its own: nothing shared is consulted, so nothing is missing.
  const typed = rollUpServiceOpportunity({
    clients: withBlank,
    serviceRows,
    pricing,
    bases,
    scopeOf: (c) => (c.company === 'Epsilon' ? { serviceUnits: { 'Bill Pay': 3 } } : scopes[c.company]),
  });
  const bpTyped = byName(typed, 'Bill Pay');
  check('a count typed against the service leaves nothing to look up',
    bpTyped.clients.find(c => c.company === 'Epsilon').missingUnits.length, 0);
  check('so the whole book holds what the service needs', bpTyped.clientsWithUnits, 5);
  check('and it prices for them', bpTyped.clients.find(c => c.company === 'Epsilon').contractValue, 900);
}

// A missing count and a zero-value client are different states, and the row
// has to keep them apart: Epsilon prices at nothing on Bill Pay because the
// count is absent, not because the service is worthless to them.
{
  const withZero = [
    { company: 'Zero Sites', numberOfSites: 0, servicesExplored: {} },
    { company: 'Has Sites', numberOfSites: 4, servicesExplored: {} },
  ];
  const r = rollUpServiceOpportunity({ clients: withZero, serviceRows, pricing, bases, scopeOf });
  const bp = byName(r, 'Bill Pay');
  check('a zero count is as absent as no count, for pricing',
    bp.clientsWithUnits, 1);
  check('and the row still prices the client that has one', bp.contractValue, 1_200);
}

// ---- The explored summary reads as a sentence -----------------------------
check('explored summary names each bucket it has',
  exploredSummary({ sold: 31, inProgress: 4, notSold: 0, na: 2 }),
  '31 sold · 4 in flight · 2 N/A');
check('and is empty when nothing is explored',
  exploredSummary({ sold: 0, inProgress: 0, notSold: 0, na: 0 }), '');

console.log(failures === 0 ? '\nAll serviceOpportunity tests passed.' : `\n${failures} serviceOpportunity test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
