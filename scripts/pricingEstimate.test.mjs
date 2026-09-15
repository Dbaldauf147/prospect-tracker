// Assertion tests for remembering the Services Pricing estimator between
// visits. Plain Node — no test framework (the project has none). Run:
//   node scripts/pricingEstimate.test.mjs
//
// What this pins is that a stored estimate can be trusted on the way back
// in. The record survives a reload, so it also survives a tab closing
// mid-write, a hand edit, and a browser that refuses storage entirely —
// and the estimator it feeds prices a real deal off those numbers. So
// nothing is taken on trust: a count that isn't a number is dropped rather
// than reaching the estimate as NaN, a half-written record is a lost
// estimate rather than a broken page, and an emptied estimator leaves
// nothing behind rather than a husk that reads as a live deal.

// A localStorage stand-in, installed before the module under test reads it.
class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
globalThis.localStorage = new FakeStorage();

const {
  loadPricingEstimate, savePricingEstimate, normalizeEstimate, isEmptyEstimate, pricingEstimateKey,
} = await import('../src/utils/pricingEstimateStore.js');

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const UID = 'user-1';
const ESTIMATE = {
  scenario: {
    // The account the potential is being read for. A name rather than an
    // id, because that is what the page resolves against the client list.
    company: 'Ventas Inc',
    services: ['Bill Pay', 'Metering'],
    counts: { sites: 819, accounts: 15000 },
    // Invoice processing at 40 of the 819 sites: a fact about this deal,
    // which is why it travels with the estimate and not the rate card.
    serviceUnits: { Metering: 40 },
  },
};

// ── The round trip: what went in is what comes back ───────────────────
{
  savePricingEstimate(UID, ESTIMATE);
  check('an estimate survives the round trip', loadPricingEstimate(UID), ESTIMATE);
}

// ── One record per user ───────────────────────────────────────────────
{
  check('another user on the same browser sees nothing', loadPricingEstimate('user-2'), null);
  check('no uid, no key', pricingEstimateKey(''), '');
  savePricingEstimate('', ESTIMATE);
  check('no uid, nothing written', loadPricingEstimate(''), null);
}

// ── Clearing the scope clears the record ──────────────────────────────
{
  savePricingEstimate(UID, { scenario: { services: [], counts: {}, serviceUnits: {} } });
  check('an emptied estimator leaves nothing behind', loadPricingEstimate(UID), null);
  check('and the key is gone, not just blank',
    globalThis.localStorage.getItem(pricingEstimateKey(UID)), null);
  savePricingEstimate(UID, ESTIMATE);
}

// ── A record that can't be trusted ────────────────────────────────────
{
  check('a count that isn’t a number is dropped, not passed on as NaN',
    normalizeEstimate({ scenario: { services: ['A'], counts: { sites: 'lots', meters: -4, accounts: 12 } } }).scenario.counts,
    { accounts: 12 });
  // The estimator has no deal size box any more - a percentage service is
  // a cut of the bundle it is sold with, worked out on the page - so a deal
  // size left in an old saved record is dropped rather than restored into a
  // field nothing reads.
  check('a deal size left over from an older record is not carried back',
    normalizeEstimate({ scenario: { services: ['A'], dealSize: 300000 } }).scenario.dealSize, undefined);
  check('service names that aren’t strings are dropped',
    normalizeEstimate({ scenario: { services: ['Bill Pay', 42, null, ''] } }).scenario.services, ['Bill Pay']);
  check('junk is not an estimate', normalizeEstimate('nope'), null);
  check('an empty estimate is not stored', normalizeEstimate({ scenario: { services: [] } }), null);
  check('an untouched estimator is empty', isEmptyEstimate({ scenario: { services: [], counts: {} } }), true);
  // A company on its own IS worth remembering: picking an account is most
  // of the work of setting the page up, and a reload that threw it away
  // would mean typing the name again to see the same ranking.
  check('but an account picked with nothing ticked is not',
    isEmptyEstimate({ scenario: { company: 'Ventas Inc', services: [], counts: {} } }), false);
  check('and it survives on its own',
    normalizeEstimate({ scenario: { company: 'Ventas Inc' } })?.scenario.company, 'Ventas Inc');
  // Whitespace is not an account. Left untrimmed it would keep a record
  // alive that names nobody and rules nothing out.
  check('whitespace is not an account',
    normalizeEstimate({ scenario: { company: '   ' } }), null);
  check('units typed for this deal are worth remembering on their own',
    normalizeEstimate({ scenario: { serviceUnits: { 'Bill Pay': 40, 'Bad': 'lots' } } }).scenario.serviceUnits,
    { 'Bill Pay': 40 });
  // The estimator used to import an opp and pin its services to the top of
  // the table. Both are gone - the Deal Size popup on the Opps page prices
  // an opp now - so a record still carrying them comes back as the scenario
  // alone rather than restoring fields nothing reads.
  check('an older record\'s import and pins are left behind',
    Object.keys(normalizeEstimate({
      scenario: { services: ['A'] },
      pinned: ['A'],
      oppImport: { account: 'Ventas', id: '17' },
    })), ['scenario']);
}

// ── A record that isn't JSON any more ─────────────────────────────────
{
  globalThis.localStorage.setItem(pricingEstimateKey(UID), '{"scenario": {"servic');
  check('a half-written record is a lost estimate, not a broken page',
    loadPricingEstimate(UID), null);
}

// ── A browser that refuses storage ────────────────────────────────────
{
  globalThis.localStorage = {
    getItem() { throw new Error('storage disabled'); },
    setItem() { throw new Error('storage disabled'); },
    removeItem() { throw new Error('storage disabled'); },
  };
  check('reading through a blocked storage gives no estimate', loadPricingEstimate(UID), null);
  savePricingEstimate(UID, ESTIMATE); // must not throw
  check('writing through a blocked storage is survivable', true, true);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
