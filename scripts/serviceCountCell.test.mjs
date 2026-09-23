// Assertion tests for the per-service count box on the Scope services table.
// Plain Node. Run:
//   node scripts/serviceCountCell.test.mjs
//
// The rules worth pinning: a service charged per unit gets a box for its own
// unit (sites, sites w/ mandate, ...), a service that isn't gets none, the
// placeholder is the count the line is actually priced on, and a count typed
// for one service re-prices that service alone.
import { estimateScope } from '../src/utils/servicePricing.js';
import { serviceCountCell } from '../src/utils/oppDealCounts.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const RECURRING = { serviceType: 'Recurring', years: '3 years' };
const rows = [
  { name: 'Bill pay', meta: RECURRING },
  { name: 'BPS reporting', meta: RECURRING },
  { name: 'Flat thing', meta: RECURRING },
  { name: 'Mgmt fee', meta: RECURRING },
  { name: 'Setup heavy', meta: RECURRING },
];
const pricing = {
  'Bill pay': { basis: 'per_site', rate: 100 },
  'BPS reporting': { basis: 'per_site_mandate', rate: 500 },
  'Flat thing': { basis: 'flat', rate: 9000 },
  'Mgmt fee': { basis: 'pct_deal', rate: 3 },
  // Headline fee is flat; only the setup is per site. The estimator never
  // lays a typed count over it, so it must not be offered a box.
  'Setup heavy': { basis: 'flat', rate: 1000, setupLines: [{ basis: 'per_site', rate: 10 }] },
};
const counts = { sites: 207, sites_mandate: 70 };
const est = (serviceUnits = null) => estimateScope({
  rows, services: rows.map(r => r.name), pricing, counts, dealSize: 100000, serviceUnits,
});
const cellOf = (e, name) => serviceCountCell(e.lines.find(l => l.name === name));

{
  const e = est();
  check('a per-site service asks for sites, placeholder the shared count',
    cellOf(e, 'Bill pay'), { unit: 'sites', unitLabel: 'Sites', used: 207 });
  check('a per-site-w/-mandate service asks for that count instead',
    cellOf(e, 'BPS reporting'), { unit: 'sites_mandate', unitLabel: 'Sites w/ Mandate', used: 70 });
  check('a flat service has no box', cellOf(e, 'Flat thing'), null);
  check('a percentage service has no box', cellOf(e, 'Mgmt fee'), null);
  check('a flat service with a per-site setup line has no box', cellOf(e, 'Setup heavy'), null);
}

{
  // The whole point: two services, two different site counts on one deal.
  const e = est({ 'Bill pay': 40, 'BPS reporting': 12 });
  check('a typed count becomes what the row is priced on',
    [cellOf(e, 'Bill pay').used, cellOf(e, 'BPS reporting').used], [40, 12]);
  const fee = (name) => e.lines.find(l => l.name === name).fee;
  check('and re-prices that service alone',
    [fee('Bill pay'), fee('BPS reporting')], [100 * 40, 500 * 12]);
}

{
  const e = estimateScope({
    rows: [{ name: 'Bill pay', meta: RECURRING }], services: ['Bill pay'],
    pricing, counts: {}, dealSize: '',
  });
  check('nothing answered reads as no count in use', cellOf(e, 'Bill pay').used, null);
}

check('no line is not a crash', serviceCountCell(undefined), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
