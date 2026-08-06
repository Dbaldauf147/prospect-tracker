// Assertion tests for the company site-list merge. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/siteListMerge.test.mjs
//
// The rules here decide whether a "Save to Company" adds a site or
// updates one, and both mistakes are expensive: an over-eager match folds
// two real sites into one row, a missed match saves the same site twice
// on every save. So each rule is pinned rather than left to the caller.
import { mergeIntoSiteList, identityColumns } from '../src/utils/siteListMerge.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const HEADERS = ['Site Name', 'Address Line 1', 'City', 'Postal / Zip Code', 'Annual kWh'];
const site = (name, zip, over = {}) => ({
  'Site Name': name, 'Address Line 1': '1 Main St', City: 'Kankakee',
  'Postal / Zip Code': zip, 'Annual kWh': '', ...over,
});

// --- identity columns ----------------------------------------------------
{
  const cols = identityColumns(HEADERS);
  eq(cols.name, 'Site Name', 'the site-name column is found');
  eq(cols.zip, 'Postal / Zip Code', 'a "Postal / Zip Code" header is the zip');
  eq(cols.address, 'Address Line 1', 'address line 1 is the address');
  eq(cols.city, 'City', 'the city column is found');

  // A saved list carries BOTH the uploaded spelling and the analysis's
  // derived "Zip". Keying off the uploaded one keeps a re-save matching
  // the same column the first save keyed on.
  eq(identityColumns([...HEADERS, 'Zip']).zip, 'Postal / Zip Code',
    'the uploaded zip column wins over the derived one');
  eq(identityColumns(['Facility', 'Zip']).zip, 'Zip', 'a bare Zip is used when it is all there is');
  eq(identityColumns([]).name, '', 'no headers resolves to no identity');
}

// --- an empty list is just the incoming one ------------------------------
{
  const out = mergeIntoSiteList({ headers: [], rows: [] }, { headers: HEADERS, rows: [site('A', '60901')] });
  eq(out.rows.length, 1, 'merging into nothing keeps the incoming row');
  eq([out.added, out.updated], [1, 0], 'and counts it as added');
  eq(out.headers, HEADERS, 'with the incoming headers');
}

// --- the case this exists for: a second upload ADDS ----------------------
// 81 sites saved, 158 loaded, 81 of them the same ones. The company must
// end up with 158 — not 158 replacing 81, and not 239.
{
  const stored = { headers: HEADERS, rows: [site('A', '60901'), site('B', '23860')] };
  const loaded = { headers: HEADERS, rows: [site('A', '60901'), site('B', '23860'), site('C', '45600')] };
  const out = mergeIntoSiteList(stored, loaded);
  eq(out.rows.length, 3, 'the overlap merges and the new site is added');
  eq(out.added, 1, 'one site was added');
  eq(out.matched, 2, 'two matched what was already stored');
  eq(out.rows.map(r => r['Site Name']), ['A', 'B', 'C'], 'stored order is kept, new sites land at the end');
}

// --- a stored site the page no longer holds survives ---------------------
{
  const stored = { headers: HEADERS, rows: [site('Gone from this file', '10001'), site('A', '60901')] };
  const out = mergeIntoSiteList(stored, { headers: HEADERS, rows: [site('A', '60901')] });
  eq(out.rows.map(r => r['Site Name']), ['Gone from this file', 'A'],
    'a site missing from the upload is not dropped from the company');
  eq([out.added, out.matched], [0, 1], 'nothing added, one matched');
}

// --- matched rows take the fresher values, keep the rest -----------------
{
  const stored = { headers: HEADERS, rows: [site('A', '60901', { 'Annual kWh': 1000, City: 'Kankakee' })] };
  const loaded = {
    headers: [...HEADERS, 'Electric Utility'],
    rows: [{ ...site('A', '60901'), 'Annual kWh': 2500, City: '', 'Electric Utility': 'ComEd' }],
  };
  const out = mergeIntoSiteList(stored, loaded);
  eq(out.rows.length, 1, 'the same site stays one row');
  eq(out.rows[0]['Annual kWh'], 2500, 'a fresher value wins');
  eq(out.rows[0].City, 'Kankakee', 'a blank incoming value does not erase what was stored');
  eq(out.rows[0]['Electric Utility'], 'ComEd', 'a new column lands on the matched row');
  eq(out.headers.at(-1), 'Electric Utility', 'and on the end of the header list');
  eq(out.updated, 1, 'the row counts as updated');
}

// --- re-saving the identical list changes nothing ------------------------
{
  const rows = [site('A', '60901', { 'Annual kWh': 10 }), site('B', '23860')];
  const out = mergeIntoSiteList({ headers: HEADERS, rows }, { headers: HEADERS, rows });
  eq(out.rows.length, 2, 'an unchanged re-save adds nothing');
  eq([out.added, out.updated, out.matched], [0, 0, 2], 'and reports no change rather than a false update');
}

// --- two sites that share a name are not folded together ----------------
{
  const stored = { headers: HEADERS, rows: [site('Distribution Center', '60901')] };
  const loaded = { headers: HEADERS, rows: [site('Distribution Center', '75201', { City: 'Dallas' })] };
  const out = mergeIntoSiteList(stored, loaded);
  eq(out.rows.length, 2, 'the same name at a different postal code is a different site');
  eq(out.added, 1, 'so it is added, not merged over the first');
}

// --- ZIP+4 is the same site as its five-digit form ----------------------
{
  const stored = { headers: HEADERS, rows: [site('A', '60901')] };
  const out = mergeIntoSiteList(stored, { headers: HEADERS, rows: [site('A', '60901-1234')] });
  eq(out.rows.length, 1, 'ZIP+4 matches the five-digit form');
}

// --- headers spelled differently on each side ---------------------------
// The stored list came off someone's own spreadsheet; the page is holding
// a file with its own column names. Address + city carries the match.
{
  const stored = {
    headers: ['Street Address', 'City', 'Notes'],
    rows: [{ 'Street Address': '1 Main St', City: 'Kankakee', Notes: 'Toured in May' }],
  };
  const loaded = {
    headers: ['Site Name', 'Address Line 1', 'City', 'Postal / Zip Code'],
    rows: [{ 'Site Name': 'Kankakee Plant', 'Address Line 1': '1 Main St', City: 'Kankakee', 'Postal / Zip Code': '60901' }],
  };
  const out = mergeIntoSiteList(stored, loaded);
  eq(out.rows.length, 1, 'address + city matches across differently-named columns');
  eq(out.rows[0].Notes, 'Toured in May', 'the stored row keeps its own columns');
  eq(out.rows[0]['Postal / Zip Code'], '60901', 'and gains the incoming ones');
  eq(out.headers, ['Street Address', 'City', 'Notes', 'Site Name', 'Address Line 1', 'Postal / Zip Code'],
    'headers are the union, stored order first');
}

// --- a shared address with two names stays two sites --------------------
// Buildings on one campus share a street address and differ only by name.
// Saving one over the other would lose a site silently; saving it twice
// is visible and undoable, so the conflict wins over the address match.
{
  const stored = { headers: HEADERS, rows: [site('Building A', '60901')] };
  const out = mergeIntoSiteList(stored, { headers: HEADERS, rows: [site('Building B', '60901')] });
  eq(out.rows.length, 2, 'two names at one address are two sites');
  eq(out.rows.map(r => r['Site Name']), ['Building A', 'Building B'], 'and neither overwrites the other');
}

// --- an ambiguous weak key matches nothing ------------------------------
// Two stored rows with the same name and no zip identify neither: merging
// onto one of them would be a guess.
{
  const cols = ['Site Name', 'Annual kWh'];
  const stored = {
    headers: cols,
    rows: [{ 'Site Name': 'Warehouse', 'Annual kWh': 1 }, { 'Site Name': 'Warehouse', 'Annual kWh': 2 }],
  };
  const out = mergeIntoSiteList(stored, { headers: cols, rows: [{ 'Site Name': 'Warehouse', 'Annual kWh': 3 }] });
  eq(out.rows.length, 3, 'an ambiguous name is not merged onto either row');
  eq(out.rows.map(r => r['Annual kWh']), [1, 2, 3], 'and neither stored row is overwritten');
}

// --- unidentifiable rows don't stack up ---------------------------------
// The blank-name spacer row the page reports as "1 blank-name row
// ignored" is still in the uploaded data, so it is saved — but saving
// twice must not leave two of it.
{
  const blank = { 'Site Name': '', 'Address Line 1': '', City: '', 'Postal / Zip Code': '', 'Annual kWh': '' };
  const noted = { ...blank, 'Annual kWh': 'TOTAL' };
  const first = mergeIntoSiteList({ headers: [], rows: [] }, { headers: HEADERS, rows: [site('A', '60901'), noted] });
  const second = mergeIntoSiteList(first, { headers: HEADERS, rows: [site('A', '60901'), noted] });
  eq(second.rows.length, 2, 'a row with no identity dedupes on its own content');
  const empty = mergeIntoSiteList({ headers: HEADERS, rows: [blank] }, { headers: HEADERS, rows: [blank] });
  eq(empty.rows.length, 1, 'a wholly empty row does the same');
}

// --- every row carries every column -------------------------------------
{
  const stored = { headers: ['Site Name'], rows: [{ 'Site Name': 'Old' }] };
  const out = mergeIntoSiteList(stored, { headers: ['Site Name', 'ISO / RTO'], rows: [{ 'Site Name': 'New', 'ISO / RTO': 'PJM' }] });
  eq(out.rows[0], { 'Site Name': 'Old', 'ISO / RTO': '' }, 'a stored row gains the new column as a blank, not a hole');
  eq(out.rows[1], { 'Site Name': 'New', 'ISO / RTO': 'PJM' }, 'and the new row carries its value');
}

// --- junk in, no crash ---------------------------------------------------
{
  eq(mergeIntoSiteList(null, null).rows, [], 'two nothings merge to nothing');
  eq(mergeIntoSiteList({ headers: null, rows: null }, { headers: HEADERS, rows: [null, site('A', '1')] }).rows.length,
    1, 'null rows are dropped rather than saved');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
