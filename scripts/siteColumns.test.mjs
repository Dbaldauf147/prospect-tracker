// Assertion tests for sites-file column detection — which column of an
// uploaded workbook the Utility Lookup mapping modal pre-selects for each
// field. Plain Node — no test framework (the project has none).
// Run:
//   node scripts/siteColumns.test.mjs
//
// Detection failing is quiet: the page renders either way, just with the
// wrong column under the right label. The case that started this file is
// the last one below — a sheet whose first column is "Site ID" had Site
// Name auto-mapped to the ID, because the old single-alternation match
// took the first header in FILE order that mentioned "site".
import { pickSiteNameColumn, pickZipColumn, detectColumn } from '../src/utils/siteColumns.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ---- detectColumn: pattern order decides, not file order ----------------

eq(detectColumn(['Total', 'Annual Electric Spend ($)'], [/annual.*electric.*spend/i, /total/i]),
  'Annual Electric Spend ($)', 'detectColumn: the earlier PATTERN wins, whatever the column order');
eq(detectColumn(['City', 'State'], [/zip/i]), '', 'detectColumn: no match reads as nothing found');
eq(detectColumn([], [/anything/i]), '', 'detectColumn: no headers reads as nothing found');

// ---- pickSiteNameColumn -------------------------------------------------

eq(pickSiteNameColumn([]), '', 'site name: no headers');
eq(pickSiteNameColumn(['Site Name', 'Site ID', 'City']), 'Site Name',
  'site name: the obvious column, already first');
eq(pickSiteNameColumn(['Site', 'Site Name', 'City']), 'Site Name',
  'site name: an exact "Site Name" beats a bare "Site" that comes before it');
eq(pickSiteNameColumn(['Location Code', 'Region', 'Location Name']), 'Location Name',
  'site name: "Location Code" is an identifier, "Location Name" is the label');
eq(pickSiteNameColumn(['Property #', 'Property Name']), 'Property Name',
  'site name: a # column is an identifier too');
eq(pickSiteNameColumn(['Building ID', 'Building Name']), 'Building Name',
  'site name: Building ID does not shadow Building Name');
eq(pickSiteNameColumn(['Store Number', 'Name', 'State']), 'Name',
  'site name: a plain "Name" column is a site name');
eq(pickSiteNameColumn(['Facility ID', 'Facility', 'Zip']), 'Facility',
  'site name: bare "Facility" over "Facility ID"');

// An identifier is still better than nothing: with no label column on the
// sheet, the ID is the only thing naming the site, and calling a row by its
// address would be worse.
eq(pickSiteNameColumn(['Site ID', 'Address', 'City']), 'Site ID',
  'site name: the ID wins when the sheet has no name column at all');
eq(pickSiteNameColumn(['Zip', 'kWh', 'Therms']), 'Zip',
  'site name: nothing name-ish falls back to the first column');

// The reported file: Site ID leads the sheet and Site Name is the 4th
// column. Every header here that mentions "site" — Site ID, Site Name,
// Site Function — matched the old alternation, so file order decided and
// Site Name was mapped to Site ID.
eq(pickSiteNameColumn([
  'Site ID', 'Parent Company', 'Operating Brand / Subsidiary', 'Site Name',
  'Property Type', 'Site Function', 'Address', 'City', 'State / Province',
  'Postal / ZIP Code', 'Country', 'Region', 'Tenure Category',
]), 'Site Name', 'site name: Hornblower sheet — Site Name, not Site ID or Site Function');

// ---- pickZipColumn ------------------------------------------------------

eq(pickZipColumn([]), '', 'zip: no headers');
eq(pickZipColumn(['Site Name', 'City']), '',
  'zip: a file with no zip column gets none — never a guess at column 0');
eq(pickZipColumn(['Site Name', 'Postal / ZIP Code']), 'Postal / ZIP Code', 'zip: Postal / ZIP Code');
eq(pickZipColumn(['Zip Code', 'Postal Code']), 'Zip Code', 'zip: exact "Zip Code" leads');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
