// Assertion tests for services priced on a share of the shared site count.
// Run: node scripts/siteShare.test.mjs
//
// Open/Close is charged when a site opens or closes an account, which in a
// year is a minority of the book, so the deal prices it on 30% of the
// shared Sites count. Pinned: the shared count is scaled and rounded to
// whole sites, a count typed against the service is left as typed, setup
// lines charged per site follow the same share, other per-site services are
// untouched, and the working says where the count came from.
import { estimateScope, siteShareFor } from '../src/utils/servicePricing.js';
import { scopeLineMath } from '../src/utils/scopeLineMath.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const PROJECT = { serviceType: 'Project', years: '1 year' };
const rows = [{ name: 'Open/Close', meta: PROJECT }, { name: 'Bill Pay', meta: PROJECT }];
const pricing = {
  'Open/Close': { basis: 'per_site', rate: 100, setupLines: [{ basis: 'per_site', rate: 10 }] },
  'Bill Pay': { basis: 'per_site', rate: 100 },
};
const run = (extra = {}) => estimateScope({
  rows, services: ['Open/Close', 'Bill Pay'], pricing, counts: { sites: 819 }, dealSize: '', ...extra,
});

check('Open/Close carries a 30% share', siteShareFor('Open/Close'), 0.3);
check('matched however it is punctuated', siteShareFor('open close'), 0.3);
check('other services carry none', siteShareFor('Bill Pay'), null);

const est = run();
const oc = est.lines.find(l => l.name === 'Open/Close');
const bp = est.lines.find(l => l.name === 'Bill Pay');
check('Open/Close prices on 30% of 819 sites, rounded', oc.breakdown[0].units, 246);
check('so its fee is the rate on 246 sites', oc.fee, 100 * 246);
check('its per-site setup follows the same share', oc.setup, 10 * 246);
check('other per-site services still use every site', bp.fee, 100 * 819);
check('the part records the share', oc.breakdown[0].siteShare, { pct: 30, of: 819, sites: 246 });

const math = scopeLineMath(oc);
check('the working shows the scaled count', math.steps[0].math, '$100 per site × 246');
check('and says where it came from', math.steps[0].source.startsWith('30% of the 819 sites'), true);

const typed = run({ serviceUnits: { 'Open/Close': 50 } });
const ocTyped = typed.lines.find(l => l.name === 'Open/Close');
check('a count typed against Open/Close is left as typed', ocTyped.fee, 100 * 50);
check('and is not marked as a share', ocTyped.breakdown[0].siteShare, undefined);

const small = estimateScope({ rows, services: ['Open/Close'], pricing, counts: { sites: 1 }, dealSize: '' });
check('never rounds down to no sites', small.lines[0].breakdown[0].units, 1);

const none = estimateScope({ rows, services: ['Open/Close'], pricing, counts: {}, dealSize: '' });
check('no shared count is still a gap, not a share of nothing', none.lines[0].breakdown[0].gap?.kind, 'units');

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
