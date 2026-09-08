// Assertion tests for the Clients tab's Deal Sizing subtab.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/clientDealSizing.test.mjs
//
// The arithmetic itself is servicePricing.js's and is tested there. What is
// new here is the join: taking a client record and a set of ticked services
// and deciding what numbers the estimate runs on. Three things in that join
// are easy to get wrong and all three are quiet.
//
//   1. Where a count comes from. A per-site service priced against a client
//      uses the company record's site count, which is what makes a client
//      estimable with no data entry — but a portfolio is not a scope, so a
//      number typed for the deal has to beat it. Getting that backwards
//      silently prices every rollout across the whole estate.
//   2. Services that left the catalog. A scope is saved per client and
//      outlives any given service name. A name that has since been renamed
//      or retired must be REPORTED, not skipped: skipping it means a scope
//      of four services quietly prices like three and nothing says why.
//   3. What "nothing" means. A client with no services picked is not a
//      client worth $0 — it is a client nobody has sized. The roll-up counts
//      those apart so an untouched book doesn't read as a worthless one.
import {
  clientCounts,
  emptyClientScope,
  estimateClient,
  missingCounts,
  needsDealSize,
  normalizeClientScope,
  rollUpDealSizing,
  scopeIsEmpty,
} from '../src/utils/clientDealSizing.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

// A small catalog and rate card, standing in for the Services and Services
// Pricing subtabs. Bill pay is recurring over three years and priced per
// site; the retrofit is a one-off flat job; the audit is priced per meter,
// which no client record answers; the levy is a cut of the deal size.
const serviceRows = [
  { name: 'Bill pay',  meta: { serviceType: 'Recurring', years: '3 years' } },
  { name: 'Retrofit',  meta: { serviceType: 'Project' } },
  { name: 'Meter audit', meta: { serviceType: 'Recurring', years: '1 year' } },
  { name: 'Levy',      meta: { serviceType: 'Project' } },
  { name: 'Unpriced',  meta: { serviceType: 'Project' } },
];
const pricing = {
  'Bill pay': { basis: 'per_site', rate: '450' },
  Retrofit: { basis: 'flat', rate: '25000' },
  'Meter audit': { basis: 'per_meter', rate: '12' },
  Levy: { basis: 'pct_deal', rate: '5' },
  Unpriced: {},
};
const PROLOGIS = { company: 'Prologis', numberOfSites: '6,176', numberOfAccounts: 10000 };

// ---- normalizing a stored scope -----------------------------------------
//
// These records are per-client and long-lived, so a scope written by an
// older version or edited by hand comes back usable rather than taking the
// client's whole scope down with it.

check('normalize: nothing in, an empty scope out',
  normalizeClientScope(null), emptyClientScope());
check('normalize: junk in, an empty scope out',
  normalizeClientScope('not a scope'), emptyClientScope());
check('normalize: duplicate and blank service names are dropped',
  normalizeClientScope({ services: ['Bill pay', ' Bill pay ', '', null, 'Retrofit'] }).services,
  ['Bill pay', 'Retrofit']);
check('normalize: counts are numbers, and unparseable ones are left out',
  normalizeClientScope({ counts: { sites: '1,200', meters: 'lots', users: 4 } }).counts,
  { sites: 1200, users: 4 });
check('normalize: the deal size keeps its typed form',
  normalizeClientScope({ dealSize: 500000 }).dealSize, '500000');

check('empty: an untouched scope is empty', scopeIsEmpty(emptyClientScope()), true);
check('empty: one ticked service is not', scopeIsEmpty({ services: ['Bill pay'] }), false);
// A count typed against a client with nothing ticked is still worth keeping:
// it is an answer the user gave, and throwing it away would make them give it
// twice.
check('empty: a typed count alone is not', scopeIsEmpty({ counts: { meters: 40 } }), false);

// ---- where the counts come from -----------------------------------------

check('counts: the company record answers sites and accounts',
  clientCounts(PROLOGIS, emptyClientScope()),
  { counts: { sites: 6176, accounts: 10000 }, sources: { sites: 'client', accounts: 'client' } });

// The rule that matters. A portfolio count is what the account HAS; a typed
// one is what the deal COVERS, and you rarely sell into all 6,176 sites at
// once.
check('counts: a number typed for the deal beats the portfolio',
  clientCounts(PROLOGIS, { counts: { sites: 400 } }),
  { counts: { sites: 400, accounts: 10000 }, sources: { sites: 'typed', accounts: 'client' } });

check('counts: a record with nothing on it contributes nothing',
  clientCounts({ company: 'Quiet Co' }, emptyClientScope()), { counts: {}, sources: {} });
check('counts: a zero on the record is not a count',
  clientCounts({ numberOfSites: 0 }, emptyClientScope()), { counts: {}, sources: {} });
// A unit no client record knows — typed against this client or not at all.
check('counts: a unit off the record can still be typed',
  clientCounts(PROLOGIS, { counts: { meters: 900 } }).counts,
  { sites: 6176, accounts: 10000, meters: 900 });

// ---- estimating one client ----------------------------------------------

const prologis = estimateClient({
  client: PROLOGIS,
  scope: { services: ['Bill pay', 'Retrofit'] },
  serviceRows, pricing,
});
// 6,176 sites × $450 = $2,779,200 a year, three years = $8,337,600, plus the
// $25,000 retrofit once.
check('estimate: the record\'s own counts price the scope with nothing typed',
  [prologis.recurringAnnual, prologis.year1Total, prologis.contractValue],
  [2779200, 2804200, 8362600]);
check('estimate: it reports which counts it ran on',
  prologis.counts, { sites: 6176, accounts: 10000 });

// A rollout that covers part of the estate, typed against the one service.
const partial = estimateClient({
  client: PROLOGIS,
  scope: { services: ['Bill pay'], serviceUnits: { 'Bill pay': 400 } },
  serviceRows, pricing,
});
check('estimate: a count typed against ONE service prices only that service',
  [partial.recurringAnnual, partial.counts.sites], [180000, 6176]);

check('estimate: an empty scope is zero, and says it has no services',
  (() => {
    const e = estimateClient({ client: PROLOGIS, scope: emptyClientScope(), serviceRows, pricing });
    return [e.services.length, e.year1Total, e.contractValue];
  })(), [0, 0, 0]);

// Rule 2: a name the catalog no longer has is reported rather than skipped.
check('estimate: a service that left the catalog is named, not silently dropped',
  (() => {
    const e = estimateClient({
      client: PROLOGIS,
      scope: { services: ['Bill pay', 'Retired service'] },
      serviceRows, pricing,
    });
    return [e.services, e.missing];
  })(), [['Bill pay'], ['Retired service']]);

// A service in the catalog with no rate on the card is a different problem,
// and servicePricing already has a word for it.
check('estimate: a service with no rate is reported as unpriced',
  estimateClient({
    client: PROLOGIS, scope: { services: ['Unpriced'] }, serviceRows, pricing,
  }).unpriced, ['Unpriced']);

// ---- what the estimate still needs --------------------------------------
//
// The per-client inputs assemble themselves out of this: tick a per-meter
// service and a Meters box appears, because a meter count is now load-bearing.

check('needs: a per-meter service with no meter count is asked for',
  missingCounts(estimateClient({
    client: PROLOGIS, scope: { services: ['Meter audit'] }, serviceRows, pricing,
  })).map(m => m.unit), ['meters']);
check('needs: a per-site service is not asked for — the record answered it',
  missingCounts(estimateClient({
    client: PROLOGIS, scope: { services: ['Bill pay'] }, serviceRows, pricing,
  })), []);
check('needs: once the count is typed, it stops being asked for',
  missingCounts(estimateClient({
    client: PROLOGIS,
    scope: { services: ['Meter audit'], counts: { meters: 900 } },
    serviceRows, pricing,
  })), []);
check('needs: and then it prices', estimateClient({
  client: PROLOGIS,
  scope: { services: ['Meter audit'], counts: { meters: 900 } },
  serviceRows, pricing,
}).recurringAnnual, 10800);

check('needs: a percentage service wants a deal size',
  needsDealSize({ services: ['Levy'], pricing }), true);
check('needs: a per-unit one does not',
  needsDealSize({ services: ['Bill pay'], pricing }), false);

// ---- the book -----------------------------------------------------------
//
// Rule 3: a client nobody has sized is not a client worth nothing.

const book = rollUpDealSizing([
  prologis,
  estimateClient({ client: { numberOfSites: 200 }, scope: { services: ['Bill pay'] }, serviceRows, pricing }),
  estimateClient({ client: { numberOfSites: 50 }, scope: emptyClientScope(), serviceRows, pricing }),
]);
check('roll-up: only scoped clients are counted as scoped',
  [book.clients, book.scoped], [3, 2]);
check('roll-up: the totals add the scoped clients up',
  [book.recurringAnnual, book.year1, book.contractValue],
  [2779200 + 90000, 2804200 + 90000, 8362600 + 270000]);
check('roll-up: nothing in, zeros out',
  [rollUpDealSizing([]).clients, rollUpDealSizing().scoped], [0, 0]);
check('roll-up: a book with no ranges does not claim one', book.ranged, false);

// A service quoted as a spread makes its client — and the book — a range.
const ranged = rollUpDealSizing([
  estimateClient({
    client: { numberOfSites: 100 },
    scope: { services: ['Bill pay'] },
    serviceRows,
    pricing: { ...pricing, 'Bill pay': { basis: 'per_site', rate: '450', rateHigh: '600' } },
  }),
]);
check('roll-up: a ranged rate carries through to the book',
  [ranged.year1, ranged.year1High, ranged.ranged], [45000, 60000, true]);

console.log(failures === 0 ? '\nAll deal-sizing tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
