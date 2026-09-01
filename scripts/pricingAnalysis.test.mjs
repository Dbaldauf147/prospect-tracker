// Assertion tests for the deal estimate frozen onto an opp. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/pricingAnalysis.test.mjs
//
// The rule worth pinning is that a saved analysis is a COPY, not a link.
// It says what the deal was priced at: the rate that was in force, the
// basis as it was labelled, the counts it was worked against. Rates get
// edited, bases get renamed, services get retired — and none of that may
// move a number on a quote that already went out. So these tests price a
// scope, save it, then change the world underneath it and check the saved
// figures don't budge.
import { estimateScope, PRICING_BASES } from '../src/utils/servicePricing.js';
import { buildPricingAnalysis, normalizePricingAnalysis, lineBasisText } from '../src/utils/pricingAnalysis.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const ROWS = [
  { name: 'Bill payment', meta: { serviceType: 'Recurring', years: '3 years' } },
  { name: 'Audits', meta: { serviceType: 'Project', years: '1 year' } },
  { name: 'CSRD readiness', meta: { serviceType: 'Project', years: '1 year' } },
];
const SERVICES = ROWS.map(r => r.name);
const PRICING = {
  'Bill payment': { basis: 'per_site', rate: 450 },
  'Audits': { avgFee: 15000 },
  // Nothing prices this one — it should be named, not silently skipped.
  'CSRD readiness': {},
};
const COUNTS = { sites: 819 };

function priced(extra = {}) {
  return estimateScope({ rows: ROWS, services: SERVICES, pricing: PRICING, counts: COUNTS, dealSize: 300000, ...extra });
}

// ── What gets saved ───────────────────────────────────────────────────
{
  const analysis = buildPricingAnalysis({
    totals: priced(), counts: COUNTS, dealSize: 300000, account: 'Ventas', savedAt: 1700000000000,
  });
  check('every service in scope gets a line', analysis.lines.map(l => l.name), SERVICES);
  check('a per-unit line carries the rate and the count it multiplied',
    [analysis.lines[0].rate, analysis.lines[0].units, analysis.lines[0].fee], [450, 819, 368550]);
  check('and the basis spelled out, not just its key',
    [analysis.lines[0].basis, analysis.lines[0].basisLabel, analysis.lines[0].unitLabel],
    ['per_site', 'Per site', 'Sites']);
  check('a typed fee says so', [analysis.lines[1].typed, analysis.lines[1].fee], [true, 15000]);
  check('an unpriced service is named rather than dropped', analysis.unpriced, ['CSRD readiness']);
  check('the totals come with it',
    [analysis.recurringAnnual, analysis.oneTime, analysis.year1Total, analysis.contractValue],
    [368550, 15000, 383550, 1120650]);
  check('so do the counts it was priced against, and the deal size',
    [analysis.counts, analysis.dealSize], [{ sites: 819 }, 300000]);
  check('and when it was saved', analysis.savedAt, 1700000000000);
}

// ── The point of saving one: the world moves, the quote doesn't ───────
{
  const analysis = buildPricingAnalysis({ totals: priced(), counts: COUNTS, dealSize: 300000, account: 'Ventas' });
  const before = JSON.stringify(analysis);

  // The rate card doubles, the basis is renamed, the service is retired.
  const laterBases = PRICING_BASES.map(b => (b.key === 'per_site' ? { ...b, label: 'Per location' } : b));
  estimateScope({
    rows: ROWS.slice(1), services: SERVICES, counts: { sites: 4 }, dealSize: 10,
    pricing: { ...PRICING, 'Bill payment': { basis: 'per_site', rate: 900 } }, bases: laterBases,
  });
  check('nothing that happens afterwards touches what was saved', JSON.stringify(analysis), before);
  check('the saved line still reads as it was priced', lineBasisText(analysis.lines[0]), 'Per site · $450 × 819');
}

// ── Units set for one deal don't come off the rate card ───────────────
{
  // 40 of the 819 sites, typed against this estimate only.
  const analysis = buildPricingAnalysis({
    totals: priced({ serviceUnits: { 'Bill payment': 40 } }), counts: COUNTS, dealSize: 300000,
  });
  check('the per-deal unit count is what priced the line',
    [analysis.lines[0].units, analysis.lines[0].fee, analysis.lines[0].unitsTyped], [40, 18000, true]);
  check('and the shared count is still recorded as what the deal was against',
    analysis.counts, { sites: 819 });
}

// ── Reading one back ──────────────────────────────────────────────────
{
  const analysis = buildPricingAnalysis({ totals: priced(), counts: COUNTS, dealSize: 300000, account: 'Ventas' });
  check('a saved analysis survives the round trip',
    normalizePricingAnalysis(JSON.parse(JSON.stringify(analysis))), analysis);
  check('junk is not an analysis', normalizePricingAnalysis('nope'), null);
  check('nor is an analysis with no lines', normalizePricingAnalysis({ lines: [], year1Total: 40000 }), null);
  check('a line with no service name is dropped',
    normalizePricingAnalysis({ lines: [{ name: '' }, { name: 'Audits', fee: 15000 }] }).lines.map(l => l.name),
    ['Audits']);
  check('a fee that isn’t a number reads as unpriced, not as NaN',
    normalizePricingAnalysis({ lines: [{ name: 'Audits', fee: 'lots' }] }).lines[0].fee, null);
  check('a missing total reads as zero rather than blanking the popup',
    normalizePricingAnalysis({ lines: [{ name: 'Audits', fee: 1 }] }).year1Total, 0);
}

// ── How a line reads ──────────────────────────────────────────────────
{
  check('a percentage line reads as a percentage',
    lineBasisText({ basisLabel: '% of deal size', kind: 'percent', rate: 3.5 }), '% of deal size · 3.5%');
  check('a flat line reads as one figure',
    lineBasisText({ basisLabel: 'Flat fee', kind: 'flat', rate: 9000 }), 'Flat fee · $9,000');
  check('a typed fee overrides the lot', lineBasisText({ typed: true, basisLabel: 'Per site' }), 'Typed fee');
  check('an unpriced line has nothing to say', lineBasisText({ basisLabel: '' }), '');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
