// Assertion tests for remembering the Services Pricing estimator between
// visits. Plain Node — no test framework (the project has none). Run:
//   node scripts/pricingEstimate.test.mjs
//
// What this pins is that a stored estimate can be trusted on the way back
// in. The record survives a reload, so it also survives a tab closing
// mid-write, a hand edit, and a browser that refuses storage entirely —
// and the estimator it feeds prices a real deal off those numbers. So
// nothing is taken on trust: a count that isn't a number is dropped rather
// than reaching the estimate as NaN, an import with no account comes back
// as no import rather than as a crash on mount, and an emptied estimator
// leaves nothing behind rather than a husk that reads as a live deal.

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
const IMPORT = {
  account: 'Ventas', id: '17', stage: 'Lead', company: 'Ventas Inc',
  services: 5, unmatchedTokens: ['widget polishing'],
  filled: [{ unit: 'sites', label: 'Sites', value: 819, source: 'the opp’s “Sites” column' }],
  dealSizeSource: 'the opp’s Quoted Amount', missing: ['Meters'], noPrice: [],
};
const ESTIMATE = {
  scenario: {
    services: ['Bill Pay', 'Metering'],
    counts: { sites: 819, accounts: 15000 },
    // Invoice processing at 40 of the 819 sites: a fact about this deal,
    // which is why it travels with the estimate and not the rate card.
    serviceUnits: { Metering: 40 },
    dealSize: 300000,
  },
  pinned: ['Bill Pay', 'Metering'],
  oppImport: IMPORT,
};

// ── The round trip: what went in is what comes back ───────────────────
{
  savePricingEstimate(UID, ESTIMATE);
  check('an imported estimate survives the round trip', loadPricingEstimate(UID), ESTIMATE);
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
  savePricingEstimate(UID, { scenario: { services: [], counts: {}, serviceUnits: {}, dealSize: '' }, pinned: null, oppImport: null });
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
  check('a deal size that isn’t a number reads as unanswered',
    normalizeEstimate({ scenario: { services: ['A'], dealSize: 'three hundred grand' } }).scenario.dealSize, '');
  check('an import with no account is no import',
    normalizeEstimate({ scenario: { services: ['A'] }, oppImport: { ...IMPORT, account: '  ' } }).oppImport, null);
  check('a filled figure that isn’t a number is dropped from the note',
    normalizeEstimate({ oppImport: { ...IMPORT, filled: [{ unit: 'sites', label: 'Sites', value: null }] } }).oppImport.filled,
    []);
  check('service names that aren’t strings are dropped',
    normalizeEstimate({ scenario: { services: ['Bill Pay', 42, null, ''] } }).scenario.services, ['Bill Pay']);
  check('an empty pin list reads as nothing pinned',
    normalizeEstimate({ scenario: { services: ['A'] }, pinned: [] }).pinned, null);
  check('junk is not an estimate', normalizeEstimate('nope'), null);
  check('an empty estimate is not stored', normalizeEstimate({ scenario: { services: [] } }), null);
  check('an untouched estimator is empty', isEmptyEstimate({ scenario: { services: [], counts: {}, dealSize: '' } }), true);
  check('units typed for this deal are worth remembering on their own',
    normalizeEstimate({ scenario: { serviceUnits: { 'Bill Pay': 40, 'Bad': 'lots' } } }).scenario.serviceUnits,
    { 'Bill Pay': 40 });
  check('and the opp the estimate came from is kept, to save back to',
    normalizeEstimate({ scenario: { services: ['A'] }, oppImport: IMPORT }).oppImport.id, '17');
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
