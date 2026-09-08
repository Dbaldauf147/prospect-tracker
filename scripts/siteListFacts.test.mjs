// Assertion tests for the company site-list summary. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/siteListFacts.test.mjs
//
// A company's site list is assembled from three paths — the Utility
// Lookup save, the paste-and-map modal, and a raw spreadsheet upload —
// and only the first two control their own column names. So the header
// matching is what these tests are mostly about.
import { siteListFacts, siteListScreeningRows, formatSqft, toSqft } from '../src/utils/siteListFacts.js';

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
  eq(siteListFacts(null),
    {
      sites: 0, sqft: null, sqftSites: 0, equipment: null, equipmentSites: 0,
      accounts: null, accountSites: 0, divisions: [], propertyTypes: [],
    },
    'no list is no facts');
  eq(siteListFacts({ headers: ['Site Name'], rows: [{ 'Site Name': 'A' }] }).sqft, null,
    'a list with no size column reports no size');
  eq(siteListFacts({ headers: ['Site Name'], rows: [{ 'Site Name': 'A' }] }).divisions, [],
    'and no divisions');
}

// --- equipment, off the count or off the property type ------------------
{
  // No equipment column: the property type is what the count comes from,
  // which is the case for every list that predates the Est. Equipment
  // field or came in as a plain spreadsheet.
  const fromTypes = siteListFacts({
    headers: ['Site Name', 'Property Type'],
    rows: [
      { 'Site Name': 'A', 'Property Type': 'Data Center' },          // 200
      { 'Site Name': 'B', 'Property Type': 'Non-Refrigerated Warehouse' }, // 28
      { 'Site Name': 'C', 'Property Type': 'Hotel / Lodging' },      // 290
    ],
  });
  eq(fromTypes.equipment, 518, 'equipment totals off the property types');
  eq(fromTypes.equipmentSites, 3, 'and says how many sites it counted');

  // A type nobody can resolve contributes nothing and is left out of the
  // site count behind the total, so a partial answer can't read as whole.
  const partial = siteListFacts({
    headers: ['Site Name', 'Property Type'],
    rows: [
      { 'Site Name': 'A', 'Property Type': 'Data Center' },
      { 'Site Name': 'B', 'Property Type': 'Cell tower' },
    ],
  });
  eq(partial.equipment, 200, 'an unresolvable type adds nothing');
  eq(partial.equipmentSites, 1, 'and is not counted as a site behind the total');

  // The written count wins over the lookup — it is what the analysis
  // resolved for that site, including a corrected property type.
  const stated = siteListFacts({
    headers: ['Site Name', 'Property Type', 'Est. Equipment'],
    rows: [
      { 'Site Name': 'A', 'Property Type': 'Data Center', 'Est. Equipment': 40 },
      { 'Site Name': 'B', 'Property Type': 'Data Center', 'Est. Equipment': '' },
    ],
  });
  eq(stated.equipment, 240, 'a written count wins, a blank one falls back to the type');

  // A collision renames the analysis column; the prefix still matches.
  eq(siteListFacts({
    headers: ['Site Name', 'Est. Equipment (analysis)'],
    rows: [{ 'Site Name': 'A', 'Est. Equipment (analysis)': '1,200' }],
  }).equipment, 1200, 'the (analysis) suffix and thousands separators are handled');

  // Land carries a real zero — a counted site with nothing in it.
  const land = siteListFacts({
    headers: ['Site Name', 'Property Type'],
    rows: [{ 'Site Name': 'A', 'Property Type': 'Land' }],
  });
  eq(land.equipment, 0, 'land counts as zero equipment');
  eq(land.equipmentSites, 1, 'and is a site the total was built from');

  eq(siteListFacts({ headers: ['Site Name'], rows: [{ 'Site Name': 'A' }] }).equipment, null,
    'nothing to count on reports no equipment');
}

// --- accounts: the bills behind the buildings ----------------------------
//
// Same shape as equipment — the per-site figure the analysis wrote, else the
// property type looked up — because it is the number the Utility Lookup save
// stamps as a company's Number of Accounts, and the popup's Refresh reads it
// back off the saved list. The two must agree.
{
  const f = siteListFacts({
    headers: ['Site Name', 'Property Type', 'Est. Utility Accounts'],
    rows: [
      { 'Site Name': 'HQ', 'Property Type': 'Office', 'Est. Utility Accounts': 4 },
      { 'Site Name': 'Depot', 'Property Type': 'Office', 'Est. Utility Accounts': 2.5 },
    ],
  });
  eq(f.accounts, 7, 'a fractional per-site estimate is only rounded in the total');
  eq(f.accountSites, 2, 'and every row it came from is counted');

  // A list that never went through the Utility Lookup page has no written
  // estimate, so the property type answers instead.
  const est = siteListFacts({
    headers: ['Property Type'],
    rows: [{ 'Property Type': 'Office' }, { 'Property Type': 'Office' }],
  });
  eq(est.accounts != null && est.accounts > 0, true, 'a bare property type still totals');

  // A zero the analysis wrote (Land, Debt — no accounts to estimate) is not
  // an answer that beats the lookup; it agrees with it.
  eq(siteListFacts({ headers: ['Property Type'], rows: [{ 'Property Type': 'Land' }] }).accounts, null,
    'a property type with nothing to estimate reports no accounts rather than zero');
  eq(siteListFacts({ headers: ['Site Name'], rows: [{ 'Site Name': 'HQ' }] }).accounts, null,
    'nothing to count on reports no accounts');
  eq(siteListFacts(null).accounts, null, 'and no list at all is not zero accounts');
}

// --- the list as screening rows -----------------------------------------
//
// What the compliance screener is handed when the popup refreshes its
// figures. The analysis columns are the ones the Utility Lookup page
// resolved, so where a list carries both they are the ones that count.
{
  const rows = siteListScreeningRows({
    headers: ['Site Name', 'City', 'ST / Prov', 'Country', 'Property Type', 'Size (ft²)'],
    rows: [{
      'Site Name': 'HQ', City: 'Seattle', 'ST / Prov': 'WA', Country: 'United States',
      'Property Type': 'Office', 'Size (ft²)': '60,000',
    }],
  });
  eq(rows, [{
    id: 0, siteName: 'HQ', city: 'Seattle', state: 'WA', country: 'United States',
    sqft: 60000, propertyType: 'Office',
  }], 'the canonical columns map straight onto a screening row');

  // An uploaded list with its own spellings, and no analysis columns at all.
  eq(siteListScreeningRows({
    headers: ['Property Name', 'City', 'State', 'SQFT', 'Building Type'],
    rows: [{ 'Property Name': 'Mill', City: 'Boston', State: 'MA', SQFT: '90000', 'Building Type': 'Warehouse' }],
  }), [{
    id: 0, siteName: 'Mill', city: 'Boston', state: 'MA', country: '',
    sqft: 90000, propertyType: 'Warehouse',
  }], 'and an upload that kept its own headers still screens');

  // A missing column is a blank, not a crash: the screener treats an
  // unplaceable site as matching no jurisdiction, which is the truth.
  eq(siteListScreeningRows({ headers: ['Site Name'], rows: [{ 'Site Name': 'Unknown' }] }), [{
    id: 0, siteName: 'Unknown', city: '', state: '', country: '', sqft: null, propertyType: '',
  }], 'a list with nothing to place reads as a row with nothing on it');
  eq(siteListScreeningRows(null), [], 'no list, no rows');
  eq(siteListScreeningRows({ headers: ['City'], rows: [] }), [], 'and no rows, no rows');
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
