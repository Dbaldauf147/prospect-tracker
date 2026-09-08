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
//   3. Putting one service in front of the whole book. This is the only
//      action on the page that writes to every client at once, and there is
//      no way to eyeball forty rows to see what it did — so what it will do
//      has to be exactly what it does, and a client who already BUYS the
//      service has to be tellable from one who simply hasn't been offered it.
//      Sizing work a client already pays for as new business is how a book
//      quietly doubles.
//   4. What "nothing" means. A client with no services picked is not a
//      client worth $0 — it is a client nobody has sized. The roll-up counts
//      those apart so an untouched book doesn't read as a worthless one.
import {
  clientCounts,
  exploredStatus,
  planBulkAdd,
  planBulkRemove,
  scopeStatusCounts,
  withService,
  withoutService,
  emptyClientScope,
  estimateClient,
  dealSizingWarnings,
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
  // A second per-meter service, so a warning can be checked for naming EVERY
  // service one missing count is starving rather than just the first.
  { name: 'Second audit', meta: { serviceType: 'Recurring', years: '1 year' } },
  { name: 'Levy',      meta: { serviceType: 'Project' } },
  { name: 'Unpriced',  meta: { serviceType: 'Project' } },
];
const pricing = {
  'Bill pay': { basis: 'per_site', rate: '450' },
  Retrofit: { basis: 'flat', rate: '25000' },
  'Meter audit': { basis: 'per_meter', rate: '12' },
  'Second audit': { basis: 'per_meter', rate: '8' },
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

// Which SERVICE is starved, not just which number is absent. "No meters
// count" tells you something is missing; naming the service tells you what it
// is costing, which is the difference between a warning you can act on and
// one you have to go and investigate.
check('needs: the missing count names the service waiting on it',
  missingCounts(estimateClient({
    client: PROLOGIS, scope: { services: ['Meter audit', 'Retrofit'] }, serviceRows, pricing,
  })).map(m => [m.unit, m.services]), [['meters', ['Meter audit']]]);

// ---- the warning beside the company -------------------------------------
//
// One list, printed twice: as a badge next to the company name (where the
// figures are actually read) and in the Needs column. Built once here so the
// two can't come to disagree.

const warn = (scope, client = PROLOGIS) => dealSizingWarnings({
  estimate: estimateClient({ client, scope, serviceRows, pricing }), pricing,
});

check('warn: a client whose record answers everything has nothing to say',
  warn({ services: ['Bill pay'] }), []);
check('warn: a missing count says which service it starves',
  warn({ services: ['Meter audit'] }).map(w => [w.chip, w.detail]),
  [['No meters count', 'No meters count for this client, so Meter audit prices at nothing.']]);
check('warn: two services on one missing count are both named',
  warn({ services: ['Meter audit', 'Second audit'] }).map(w => w.detail),
  ['No meters count for this client, so Meter audit, Second audit price at nothing.']);
check('warn: a percentage service with no deal size',
  warn({ services: ['Levy'] }).map(w => [w.key, w.chip]), [['dealSize', 'No deal size']]);
check('warn: and it goes quiet once a deal size is typed',
  warn({ services: ['Levy'], dealSize: '500000' }), []);
check('warn: a service with no rate is reported as unpriced',
  warn({ services: ['Unpriced'] }).map(w => [w.chip, w.detail]),
  [['1 unpriced', 'No rate set on Unpriced — price it on Dropdowns › Services Pricing.']]);
check('warn: a service that has left the catalog is reported too',
  warn({ services: ['Gone away'] }).map(w => w.key), ['catalog']);
// A count typed against the one service does not need the shared one, so the
// warning goes — the same rule that decides whether a box is even asked for.
check('warn: a count typed against the service settles it',
  warn({ services: ['Meter audit'], serviceUnits: { 'Meter audit': 200 } }), []);
check('warn: everything wrong at once, in a stable order',
  warn({ services: ['Meter audit', 'Levy', 'Unpriced', 'Gone away'] }).map(w => w.key),
  ['count:meters', 'dealSize', 'unpriced', 'catalog']);
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

// ---- what the company card already says ---------------------------------
//
// A scope is a what-if; the card is history. They are stored apart and shown
// together, so reading the card correctly is what stops the page proposing
// work the client already buys.

const CARD = {
  company: 'Prologis',
  numberOfSites: 6176,
  servicesExplored: { 'Bill pay': 'Sold', Retrofit: 'Quoting', Levy: 'Not Sold', 'Meter audit': '-' },
};

check('card: a status is read off the company record',
  exploredStatus(CARD, 'Bill pay'), 'Sold');
// The card writes "no status" as a dash. Reporting that as a status called
// "-" would put a meaningless chip on the row.
check('card: a dash means unexplored, not a status called "-"',
  exploredStatus(CARD, 'Meter audit'), '');
check('card: a service the card has never heard of is unexplored',
  exploredStatus(CARD, 'Unpriced'), '');
check('card: no record at all is not an error', exploredStatus(null, 'Bill pay'), '');

check('card: a scope\'s statuses roll up by outcome',
  scopeStatusCounts(CARD, { services: ['Bill pay', 'Retrofit', 'Levy', 'Meter audit'] }),
  { sold: 1, inProgress: 1, notSold: 1, na: 0, none: 1 });
check('card: an empty scope rolls up to nothing',
  scopeStatusCounts(CARD, emptyClientScope()),
  { sold: 0, inProgress: 0, notSold: 0, na: 0, none: 0 });

// ---- adding one service to the whole book -------------------------------

const BOOK = [
  { company: 'Fresh', servicesExplored: {} },                          // new ground
  { company: 'Scoped', servicesExplored: {} },                         // already picked
  { company: 'Buyer', servicesExplored: { 'Bill pay': 'Sold' } },      // already buys it
  { company: 'Quoting', servicesExplored: { 'Bill pay': 'Quoting' } }, // in flight, not sold
  { company: 'Lost', servicesExplored: { 'Bill pay': 'Not Sold' } },   // said no before
];
const bookScopes = { Scoped: { services: ['Bill pay'] } };
const scopeOf = (c) => bookScopes[c.company] || emptyClientScope();
const names = (list) => list.map(c => c.company);

const plan = planBulkAdd({ clients: BOOK, service: 'Bill pay', scopeOf });
check('bulk: only the clients who would actually change are targeted',
  names(plan.add), ['Fresh', 'Quoting', 'Lost']);
check('bulk: a client who already has it in scope is reported, not re-added',
  names(plan.scoped), ['Scoped']);
// The one that matters. "Sold" is the only status that means the client is
// already paying for it; Quoting and Not Sold are both still open questions
// and belong in the add.
check('bulk: a client who already BUYS it is held back by default',
  names(plan.sold), ['Buyer']);

check('bulk: and can be included deliberately — a renewal is a real thing to size',
  names(planBulkAdd({ clients: BOOK, service: 'Bill pay', scopeOf, skipSold: false }).add),
  ['Fresh', 'Buyer', 'Quoting', 'Lost']);
// Included or not, the client is still reported as one who buys it, so the
// bar can say the figures are a renewal rather than new business.
check('bulk: including them does not stop them being reported as buyers',
  names(planBulkAdd({ clients: BOOK, service: 'Bill pay', scopeOf, skipSold: false }).sold),
  ['Buyer']);

check('bulk: every client is accounted for exactly once',
  (() => {
    const p = planBulkAdd({ clients: BOOK, service: 'Bill pay', scopeOf });
    return p.add.length + p.scoped.length + p.sold.length;
  })(), BOOK.length);

check('bulk: no service picked, nothing planned',
  planBulkAdd({ clients: BOOK, service: '', scopeOf }), { add: [], scoped: [], sold: [] });
check('bulk: an empty book plans nothing',
  planBulkAdd({ clients: [], service: 'Bill pay', scopeOf }).add, []);

// Removing is the way back out of a bulk add, so it has to find exactly the
// clients that carry the service — no more.
check('bulk: remove targets only the clients that have it',
  names(planBulkRemove({ clients: BOOK, service: 'Bill pay', scopeOf })), ['Scoped']);
check('bulk: remove with nothing picked targets nobody',
  planBulkRemove({ clients: BOOK, service: '', scopeOf }), []);

// ---- editing one scope --------------------------------------------------

check('edit: adding a service keeps the rest of the scope',
  withService({ services: ['A'], counts: { sites: 10 } }, 'B'),
  { services: ['A', 'B'], counts: { sites: 10 }, serviceUnits: {}, dealSize: '' });
check('edit: adding one that is already there changes nothing',
  withService({ services: ['A'] }, 'A').services, ['A']);
// The per-service count goes with the service. Leaving it behind means
// re-adding the service later silently inherits a count typed for a rollout
// that was abandoned — a wrong number with nothing on screen explaining it.
check('edit: removing a service takes its unit count with it',
  withoutService({ services: ['A', 'B'], serviceUnits: { A: 400, B: 12 } }, 'A'),
  { services: ['B'], counts: {}, serviceUnits: { B: 12 }, dealSize: '' });
check('edit: removing one that was never there changes nothing',
  withoutService({ services: ['A'] }, 'Z').services, ['A']);

console.log(failures === 0 ? '\nAll deal-sizing tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
