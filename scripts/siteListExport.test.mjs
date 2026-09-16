// Assertion tests for the company popup's Site List export.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/siteListExport.test.mjs
//
// What's worth pinning: that the picked columns come out in the list's own
// order rather than the order they were ticked, that a stale pick (the list
// was replaced) exports what survives instead of a file of blank columns,
// that numbers stay numbers so a spreadsheet can sum them, and that the
// filename survives a company name with punctuation in it (it keeps the
// company's own casing, the way the Portfolio Companies export does).
import {
  siteListColumns, exportCell, resolveColumns, siteListExportAoa,
  siteListCsv, columnWidths, siteListFilename,
} from '../src/utils/siteListExport.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const list = {
  headers: ['Site', 'Division', 'City', 'Sq Ft'],
  rows: [
    { Site: 'Boston Marriott Newton', Division: 'Core Assets', City: 'Newton', 'Sq Ft': 125000 },
    { Site: 'Caribe Hilton', Division: 'Core Assets', City: 'San Juan', 'Sq Ft': 0 },
  ],
};

// --- the columns on offer --------------------------------------------
check('headers in table order', siteListColumns(list), ['Site', 'Division', 'City', 'Sq Ft']);
check('no list, no columns', siteListColumns(null), []);
// A row is an object keyed by header, so a second "City" was never
// readable and a blank header names nothing to tick.
check('blank and duplicate headers drop',
  siteListColumns({ headers: ['Site', '', 'City', 'City', '   '] }),
  ['Site', 'City']);
check('headers are trimmed', siteListColumns({ headers: [' Site ', 'City'] }), ['Site', 'City']);

// --- which columns a pick resolves to ---------------------------------
check('picked columns keep the list order', resolveColumns(list, ['Sq Ft', 'Site']), ['Site', 'Sq Ft']);
check('no pick means every column', resolveColumns(list, []), ['Site', 'Division', 'City', 'Sq Ft']);
check('missing pick means every column', resolveColumns(list, undefined), ['Site', 'Division', 'City', 'Sq Ft']);
// The list was replaced by one with different columns: export what
// survives rather than a file with an empty "Tenure" column in it.
check('a stale pick exports what survives', resolveColumns(list, ['Site', 'Tenure']), ['Site']);

// --- cells -------------------------------------------------------------
check('text passes through', exportCell('Newton'), 'Newton');
check('numbers stay numbers', exportCell(125000), 125000);
check('zero is not blank', exportCell(0), 0);
check('null is blank', exportCell(null), '');
check('undefined is blank', exportCell(undefined), '');
check('infinity is blank', exportCell(Infinity), '');
check('a date goes out ISO', exportCell(new Date('2026-09-16T12:00:00Z')), '2026-09-16');

// --- the file's shape --------------------------------------------------
check('header row then one row per site', siteListExportAoa(list, ['Site', 'City']), [
  ['Site', 'City'],
  ['Boston Marriott Newton', 'Newton'],
  ['Caribe Hilton', 'San Juan'],
]);
check('a cell the row hasn\'t got is blank', siteListExportAoa({ headers: ['Site', 'Zip'], rows: [{ Site: 'A' }] }), [
  ['Site', 'Zip'],
  ['A', ''],
]);
check('an empty list is still a header row', siteListExportAoa({ headers: ['Site'], rows: [] }), [['Site']]);

// --- csv ---------------------------------------------------------------
check('csv quotes what it must',
  siteListCsv({ headers: ['Site', 'Note'], rows: [{ Site: 'Casa Marina, Key West', Note: 'He said "yes"' }] }),
  'Site,Note\r\n"Casa Marina, Key West","He said ""yes"""');

// --- column widths -----------------------------------------------------
// Sized to the longest cell so the file opens readable, floored so a short
// column is still clickable and capped so one long address does not push
// the rest of the sheet off the screen.
const widths = columnWidths([['Site', 'City'], ['Boston Marriott Newton', 'Newton']]);
check('width fits the longest cell', widths[0], { wch: 24 });
check('short column gets the floor', widths[1], { wch: 10 });
check('long column gets the cap', columnWidths([['A'], ['x'.repeat(200)]])[0], { wch: 48 });

// --- the filename ------------------------------------------------------
const day = new Date('2026-09-16T00:00:00Z');
check('name, kind and day',
  siteListFilename('Park Hotels & Resorts', 'xlsx', day),
  'Park_Hotels_Resorts_site_list_2026-09-16.xlsx');
check('csv too', siteListFilename('Park Hotels & Resorts', 'csv', day), 'Park_Hotels_Resorts_site_list_2026-09-16.csv');
check('no company still names a file', siteListFilename('', 'xlsx', day), 'company_site_list_2026-09-16.xlsx');
check('trailing punctuation does not trail', siteListFilename('Hilton, Inc.', 'xlsx', day), 'Hilton_Inc_site_list_2026-09-16.xlsx');
check('an unusable date drops the stamp', siteListFilename('Hilton', 'xlsx', new Date('nope')), 'Hilton_site_list.xlsx');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
