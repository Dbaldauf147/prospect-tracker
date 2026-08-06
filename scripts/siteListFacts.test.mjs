// Assertion tests for the company site-list summary. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/siteListFacts.test.mjs
//
// A company's site list is assembled from three paths — the Utility
// Lookup save, the paste-and-map modal, and a raw spreadsheet upload —
// and only the first two control their own column names. So the header
// matching is what these tests are mostly about.
import { siteListFacts, formatSqft, toSqft } from '../src/utils/siteListFacts.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// --- sizes, however they were written -----------------------------------
{
  eq(toSqft(125000), 125000, 'a number is a size');
  eq(toSqft('125,000'), 125000, 'thousands separators are stripped');
  eq(toSqft('125000 sf'), 125000, 'a unit suffix is stripped');
  eq(toSqft(' 1,250.5 '), 1250.5, 'a decimal survives');
  eq(toSqft(''), null, 'a blank is not a size');
  eq(toSqft('n/a'), null, 'text with no digits is not a size');
  eq(toSqft(0), null, 'zero is not a building');
  eq(toSqft(-5), null, 'nor is a negative');
}

// --- the three facts, off the canonical columns -------------------------
{
  const entry = {
    headers: ['Site Name', 'Division', 'Property Type', 'Size (ft²)'],
    rows: [
      { 'Site Name': 'A', Division: 'Kenco Logistics', 'Property Type': 'Warehouse', 'Size (ft²)': 120000 },
      { 'Site Name': 'B', Division: 'Kenco Transportation', 'Property Type': 'Warehouse', 'Size (ft²)': 80000 },
      { 'Site Name': 'C', Division: 'Kenco Logistics', 'Property Type': 'Office', 'Size (ft²)': 12000 },
    ],
  };
  const facts = siteListFacts(entry);
  eq(facts.sites, 3, 'every row is a site');
  eq(facts.sqft, 212000, 'sizes are summed');
  eq(facts.sqftSites, 3, 'and the total says how many sites it came from');
  eq(facts.divisions, ['Kenco Logistics', 'Kenco Transportation'], 'divisions are deduped and sorted');
  eq(facts.propertyTypes, ['Office', 'Warehouse'], 'so are property types');
}

// --- a size nobody filled in --------------------------------------------
// Null, not 0: "nobody has told us the sizes" and "these buildings have
// no floor area" are different statements, and only one is possible.
{
  const facts = siteListFacts({ headers: ['Site Name', 'Size (ft²)'], rows: [{ 'Site Name': 'A', 'Size (ft²)': '' }] });
  eq(facts.sqft, null, 'a list with no usable size reports null, not zero');
  eq(facts.sqftSites, 0, 'and counts no sites behind it');

  const partial = siteListFacts({
    headers: ['Site Name', 'Size (ft²)'],
    rows: [{ 'Site Name': 'A', 'Size (ft²)': 1000 }, { 'Site Name': 'B', 'Size (ft²)': '' }],
  });
  eq([partial.sqft, partial.sqftSites, partial.sites], [1000, 1, 2],
    'a partly-sized list totals what it has and says how much that was');
}

// --- headers from a spreadsheet that named things its own way -----------
{
  const spellings = [
    ['SQFT', 45000], ['Sq. Ft.', 45000], ['Square Footage', 45000], ['GSF', 45000],
    ['Building Area', 45000], ['Size (sq ft)', 45000], ['Gross Area', 45000],
  ];
  for (const [header, value] of spellings) {
    const facts = siteListFacts({ headers: ['Site Name', header], rows: [{ 'Site Name': 'A', [header]: value }] });
    eq(facts.sqft, 45000, `"${header}" is read as a size`);
  }
  const bu = siteListFacts({
    headers: ['Site Name', 'Business Unit'],
    rows: [{ 'Site Name': 'A', 'Business Unit': 'Retail' }],
  });
  eq(bu.divisions, ['Retail'], 'a Business Unit column is the division');
}

// --- the analysis's canonical property type wins ------------------------
// A list saved from the Utility Lookup page carries the uploaded column
// AND the resolved one. The resolved values group cleanly; the raw ones
// are whatever the source sheet typed.
{
  const facts = siteListFacts({
    headers: ['Site Name', 'Property Type', 'Property Type (analysis)'],
    rows: [
      { 'Site Name': 'A', 'Property Type': 'WHSE', 'Property Type (analysis)': 'Warehouse (Non-refrigerated)' },
      { 'Site Name': 'B', 'Property Type': 'whse', 'Property Type (analysis)': 'Warehouse (Non-refrigerated)' },
    ],
  });
  eq(facts.propertyTypes, ['Warehouse (Non-refrigerated)'], 'the resolved column is preferred over the raw one');
}

// --- nothing in, nothing claimed ----------------------------------------
{
  eq(siteListFacts(null), { sites: 0, sqft: null, sqftSites: 0, divisions: [], propertyTypes: [] }, 'no list is no facts');
  eq(siteListFacts({ headers: ['Site Name'], rows: [{ 'Site Name': 'A' }] }).sqft, null,
    'a list with no size column reports no size');
  eq(siteListFacts({ headers: ['Site Name'], rows: [{ 'Site Name': 'A' }] }).divisions, [],
    'and no divisions');
}

// --- how a floor area reads ---------------------------------------------
{
  eq(formatSqft(4_200_000), '4.2M ft²', 'millions keep one decimal');
  eq(formatSqft(12_400_000), '12M ft²', 'past ten million the decimal is noise');
  eq(formatSqft(860_000), '860K ft²', 'hundreds of thousands round to K');
  eq(formatSqft(12_400), '12,400 ft²', 'smaller portfolios read exactly');
  eq(formatSqft(null), '', 'no size formats as nothing');
  eq(formatSqft(0), '', 'and so does zero');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
