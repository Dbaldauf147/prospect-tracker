// Assertion tests for the Utility Lookup data summary - the table that says
// how much of an analysis is what the upload gave us and how much we worked
// out. Plain Node - no test framework (the project has none). Run:
//   node scripts/dataQualitySummary.test.mjs
//
// The whole table is a claim about provenance, and the ways it can lie are
// quiet ones: percentages that do not add to 100 so a reader cannot trust
// any of them, a real-but-small share rounding to "0% estimated" beside a
// figure that IS estimated, and - the one that matters most - a portfolio
// with nothing on file reading as a portfolio that is fully known.
import { buildDataQualitySummary, sharePcts } from '../src/components/SitesView/dataQualitySummary.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const valueOf = (summary, side, key) => summary[side].find(r => r.key === key)?.value;
const toneOf = (summary, side, key) => summary[side].find(r => r.key === key)?.tone;

// A site row as the page derives one. Only the fields this table reads.
function site(over = {}) {
  return {
    __zipNorm__: '77002',
    __zipEstimated__: false,
    __propertyTypeRaw__: 'Warehouse',
    __propertyType__: 'Warehouse',
    __ownershipRaw__: 'Owned',
    __ownership__: 'Owned',
    __division__: 'North',
    __propertySizeFt2__: 40000,
    ...over,
  };
}

// The page's own consumption / cost tally, in the shape the summary reads.
function analysisOf({ total, elecActual = 0, elecEst = 0, elecMissing = 0, gasActual = 0, gasEst = 0, gasMissing = 0 }) {
  const bucket = (actualSites, estSites, missingSites) => ({ actualSites, estSites, missingSites });
  return {
    total,
    consumption: {
      electric: bucket(elecActual, elecEst, elecMissing),
      gas: bucket(gasActual, gasEst, gasMissing),
    },
    cost: {
      electric: bucket(elecActual, elecEst, elecMissing),
      gas: bucket(gasActual, gasEst, gasMissing),
    },
  };
}

// ── The percentages add up ────────────────────────────────────────────
//
// Three sevenths and four sevenths round to 43% and 57% on their own and
// to 101% together. Largest remainder is what keeps the row honest.
{
  check('two shares sum to 100', sharePcts([3, 4]), [43, 57]);
  check('and so do three', sharePcts([1, 1, 1]).reduce((a, b) => a + b, 0), 100);
  check('a clean split is clean', sharePcts([1, 1]), [50, 50]);
  check('one bucket takes it all', sharePcts([5, 0]), [100, 0]);
  check('nothing at all divides by nothing', sharePcts([0, 0]), [0, 0]);
  // A hundredth of a portfolio is not nothing, and a table that rounds it
  // away says the figure is fully actual when it is not.
  check('a tiny real share keeps a point', sharePcts([999, 1]), [99, 1]);
  check('and the point comes off the big share', sharePcts([999, 1]).reduce((a, b) => a + b, 0), 100);
}

// ── Where the money came from ─────────────────────────────────────────
{
  const rows = Array.from({ length: 10 }, () => site());
  const s = buildDataQualitySummary({ rows, analysis: analysisOf({ total: 10, elecActual: 2, elecEst: 8, gasEst: 10 }) });
  check('the cost row reads as a split', valueOf(s, 'left', 'electricCost'), '80% estimated, 20% actual');
  check('so does consumption', valueOf(s, 'left', 'electricUse'), '80% estimated, 20% actual');
  check('a wholly estimated commodity says so once', valueOf(s, 'left', 'gasCost'), '100% estimated');
  check('an estimate is amber however complete it is', toneOf(s, 'left', 'gasCost'), 'warn');

  // Nothing on either side of the line: not 0%, which reads as a figure.
  const none = buildDataQualitySummary({ rows, analysis: analysisOf({ total: 10, elecMissing: 10, gasMissing: 10 }) });
  check('no figure at all is Missing, not 0%', valueOf(none, 'left', 'electricCost'), 'Missing');
  check('and it is red', toneOf(none, 'left', 'electricCost'), 'bad');

  // A gap is its own part of the split: a site with no figure and a site
  // with an estimated one are different problems.
  const partial = buildDataQualitySummary({ rows, analysis: analysisOf({ total: 10, elecActual: 5, elecEst: 3, elecMissing: 2 }) });
  check('a partial upload says all three', valueOf(partial, 'left', 'electricCost'), '30% estimated, 50% actual, 20% missing');

  const full = buildDataQualitySummary({ rows, analysis: analysisOf({ total: 10, elecActual: 10, gasActual: 10 }) });
  check('an upload that carried everything is green', toneOf(full, 'left', 'electricCost'), 'good');
  check('and says so plainly', valueOf(full, 'left', 'electricCost'), '100% actual');
}

// ── Zips ──────────────────────────────────────────────────────────────
{
  const rows = [
    ...Array.from({ length: 6 }, () => site()),
    ...Array.from({ length: 2 }, () => site({ __zipEstimated__: true })),
    ...Array.from({ length: 2 }, () => site({ __zipNorm__: '', __zipEstimated__: false })),
  ];
  const s = buildDataQualitySummary({ rows, analysis: analysisOf({ total: 10, elecActual: 10 }) });
  check('a zip off the file, one derived and one absent are three states',
    valueOf(s, 'left', 'zip'), '60% mapped, 20% estimated, 20% missing');
  check('the row is amber while anything is derived or absent', toneOf(s, 'left', 'zip'), 'warn');

  const clean = buildDataQualitySummary({ rows: [site(), site()], analysis: analysisOf({ total: 2, elecActual: 2 }) });
  check('every site placed reads as mapped alone', valueOf(clean, 'left', 'zip'), '100% mapped');
  check('and green', toneOf(clean, 'left', 'zip'), 'good');

  const blind = buildDataQualitySummary({
    rows: [site({ __zipNorm__: '' }), site({ __zipNorm__: '' })],
    analysis: analysisOf({ total: 2, elecActual: 2 }),
  });
  check('a portfolio with no zips at all is Missing', valueOf(blind, 'left', 'zip'), 'Missing');
}

// ── The per-building facts ────────────────────────────────────────────
//
// The distinction the right-hand column exists for: a type the file gave
// per site, against one somebody assigned across the whole list. Both leave
// every row with a property type, and only one of them is data.
{
  const perSite = buildDataQualitySummary({
    rows: [site(), site({ __propertyTypeRaw__: 'Office', __propertyType__: 'Office' })],
    analysis: analysisOf({ total: 2, elecActual: 2 }),
  });
  check('a type per building says so', valueOf(perSite, 'right', 'propertyType'), 'Per building');
  check('and is green', toneOf(perSite, 'right', 'propertyType'), 'good');

  const assigned = buildDataQualitySummary({
    rows: [
      site({ __propertyTypeRaw__: '', __propertyType__: 'Warehouse' }),
      site({ __propertyTypeRaw__: '', __propertyType__: 'Warehouse' }),
    ],
    analysis: analysisOf({ total: 2, elecActual: 2 }),
  });
  check('one type over a whole list is a decision, and reads as one',
    valueOf(assigned, 'right', 'propertyType'), 'All one type (assigned): Warehouse');
  check('which is amber, not green', toneOf(assigned, 'right', 'propertyType'), 'warn');

  const gap = buildDataQualitySummary({
    rows: [site(), site({ __propertyTypeRaw__: '', __propertyType__: null }), site({ __propertyTypeRaw__: '', __propertyType__: null })],
    analysis: analysisOf({ total: 3, elecActual: 3 }),
  });
  check('a partial column counts the sites, not the percentage',
    valueOf(gap, 'right', 'propertyType'), 'Per building on 1 of 3, missing on 2');

  const bare = buildDataQualitySummary({
    rows: [site({ __propertyTypeRaw__: '', __propertyType__: null }), site({ __propertyTypeRaw__: '', __propertyType__: null })],
    analysis: analysisOf({ total: 2, elecActual: 2 }),
  });
  check('no type at all is Missing', valueOf(bare, 'right', 'propertyType'), 'Missing');

  // Tenure runs on the same rule, and the tenure gap is the one that
  // silently inflates both the compliance screening and the savings.
  const tenure = buildDataQualitySummary({
    rows: [site(), site({ __ownershipRaw__: '', __ownership__: null })],
    analysis: analysisOf({ total: 2, elecActual: 2 }),
  });
  check('a half-filled tenure column counts the gap',
    valueOf(tenure, 'right', 'ownership'), 'Per building on 1 of 2, missing on 1');
  check('and the row still explains what the gap does',
    toneOf(tenure, 'right', 'ownership'), 'warn');

  // A tenure value the upload carried but nobody can place ("TBD", "N/A")
  // is not tenure. It reads as a gap, the same way the savings scope and
  // the compliance screening treat it - this row and those figures come off
  // one shared count for exactly that reason.
  const unplaceable = buildDataQualitySummary({
    rows: [site(), site({ __ownershipRaw__: 'TBD', __ownership__: null })],
    analysis: analysisOf({ total: 2, elecActual: 2 }),
  });
  check('a status nobody can place counts as missing',
    valueOf(unplaceable, 'right', 'ownership'), 'Per building on 1 of 2, missing on 1');
  check('and the tooltip owns up to it',
    unplaceable.right.find(r => r.key === 'ownership').title.includes('could not place'), true);
  check('the tooltip counts the owned and the leased',
    tenure.right.find(r => r.key === 'ownership').title.includes('1 owned, 0 leased'), true);

  // Accounts and equipment are never on an upload, so they are a method
  // rather than a split - and the method fails where the type is missing.
  check('accounts name their method', valueOf(tenure, 'right', 'accounts'), 'Estimated based on property type');
  check('equipment names the same one', valueOf(tenure, 'right', 'equipment'), 'Estimated based on property type');
  check('and both say when there is no type to estimate from',
    valueOf(bare, 'right', 'accounts'), 'Estimated based on property type, which is missing');
  check('which is red, because nothing downstream of it is real',
    toneOf(bare, 'right', 'equipment'), 'bad');
  check('a partial type column carries the count into both',
    valueOf(gap, 'right', 'accounts'), 'Estimated based on property type, missing on 2 of 3');
}

// ── Division and floor area ───────────────────────────────────────────
{
  const rows = [site(), site({ __division__: 'South' }), site({ __division__: 'South' })];
  const s = buildDataQualitySummary({ rows, analysis: analysisOf({ total: 3, elecActual: 3 }) });
  check('divisions are counted by name, not by site', valueOf(s, 'left', 'division'), '2 divisions');

  const partial = buildDataQualitySummary({
    rows: [site(), site({ __division__: '' })],
    analysis: analysisOf({ total: 2, elecActual: 2 }),
  });
  check('a partial division column says how many sites have none',
    valueOf(partial, 'left', 'division'), '1 division, missing on 1 of 2');

  const none = buildDataQualitySummary({
    rows: [site({ __division__: '' }), site({ __division__: null })],
    analysis: analysisOf({ total: 2, elecActual: 2 }),
  });
  check('no division anywhere is Missing', valueOf(none, 'left', 'division'), 'Missing');

  check('a size on every building reads per building', valueOf(s, 'left', 'sqft'), 'Per building');
  const sized = buildDataQualitySummary({
    rows: [site(), site({ __propertySizeFt2__: null })],
    analysis: analysisOf({ total: 2, elecActual: 2 }),
  });
  check('and a partial one counts the gap', valueOf(sized, 'left', 'sqft'), 'Per building on 1 of 2, missing on 1');
  // Zero is a size somebody typed, not a blank. It is the same distinction
  // the compliance screening makes against an ordinance threshold.
  const zero = buildDataQualitySummary({
    rows: [site({ __propertySizeFt2__: 0 }), site({ __propertySizeFt2__: 0 })],
    analysis: analysisOf({ total: 2, elecActual: 2 }),
  });
  check('a zero size is a figure, not a gap', valueOf(zero, 'left', 'sqft'), 'Per building');
}

// ── Nothing loaded ────────────────────────────────────────────────────
{
  check('no sites, no table', buildDataQualitySummary({ rows: [], analysis: null }), null);
  check('and the same with nothing passed at all', buildDataQualitySummary(), null);
}

// ── The shape the page renders ────────────────────────────────────────
{
  const s = buildDataQualitySummary({ rows: [site()], analysis: analysisOf({ total: 1, elecActual: 1 }) });
  check('seven rows down the left', s.left.map(r => r.label), [
    'Electric cost', 'Electric consumption', 'Natural gas cost', 'Natural gas consumption',
    'Zip codes', 'Division', 'Sqft',
  ]);
  check('four down the right', s.right.map(r => r.label), [
    'Property type', 'Ownership', 'Accounts', 'Equipment',
  ]);
  check('every row carries a tooltip', [...s.left, ...s.right].every(r => r.title && r.title.length > 20), true);
  check('and the total is the sites it read', s.total, 1);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
