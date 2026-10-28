// Assertion tests for the PRW Site List export.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/prwSiteListExport.test.mjs
//
// What's worth pinning: that each PRW column is filled from the column the
// Utility Lookup save wrote (or the upload's own, where the save wrote
// nothing), that a cell is marked estimated exactly when the save said it
// modeled that column, that rate columns are never read as usage, and that
// accounts fall back to the property-type estimate and say so.
import ExcelJS from 'exceljs';
import {
  PRW_COLUMNS, prwSourceColumns, prwSiteListRows, prwEstimateTally,
  prwSiteListFilename, buildPrwSiteListWorkbook, toNumber, prwRegionSummary,
} from '../src/utils/prwSiteListExport.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// A list as the Utility Lookup save leaves it: upload columns, then the
// analysis columns, then Estimated Values.
const list = {
  headers: [
    'Site Name', 'Street Address', 'City', 'State', 'Zip',
    'City (analysis)', 'Ownership', 'ST / Prov', 'Country', 'Property Type',
    'Annual Electric (kWh)', 'Electric Rate ($/kWh)', 'Total Electric Cost',
    'Annual Gas (Dth)', 'Gas Rate ($/Dth)', 'Total Natural Gas Cost',
    'Estimated Values',
  ],
  rows: [
    {
      'Site Name': 'Newton Office', 'Street Address': '1 Main St', City: 'Newton', State: 'MA', Zip: '02458',
      'City (analysis)': 'Newton', Ownership: 'Owned', 'ST / Prov': 'MA', Country: 'United States', 'Property Type': 'Office',
      'Annual Electric (kWh)': 500000, 'Electric Rate ($/kWh)': 0.2, 'Total Electric Cost': 98000,
      'Annual Gas (Dth)': 1200, 'Gas Rate ($/Dth)': 12, 'Total Natural Gas Cost': 14400,
      'Estimated Values': 'Total Natural Gas Cost, Electric Rate ($/kWh), Gas Rate ($/Dth), Annual Gas (Dth)',
    },
    {
      'Site Name': 'Austin DC', 'Street Address': '9 Elm Rd', City: '', State: 'TX', Zip: '78701',
      'City (analysis)': 'Austin', Ownership: '', 'ST / Prov': 'TX', Country: 'United States', 'Property Type': 'Not a real type',
      'Annual Electric (kWh)': '', 'Electric Rate ($/kWh)': '', 'Total Electric Cost': '$1,250',
      'Annual Gas (Dth)': '', 'Gas Rate ($/Dth)': '', 'Total Natural Gas Cost': '',
      'Estimated Values': '',
    },
    { 'Site Name': '', City: 'Nowhere' },
  ],
};

// --- source columns ----------------------------------------------------
const src = prwSourceColumns(list.headers);
check('site name', src.siteName, ['Site Name']);
check('address', src.address, ['Street Address']);
check('city: upload first, analysis second', src.city, ['City', 'City (analysis)']);
check('state: upload first, then ST / Prov', src.state, ['State', 'ST / Prov']);
check('electric usage skips the rate column', src.electricUsage, ['Annual Electric (kWh)']);
check('gas usage skips the rate column', src.gasUsage, ['Annual Gas (Dth)']);
check('analysis zip beats the upload zip',
  prwSourceColumns(['Site', 'Zip', 'Zip (analysis)']).zip, ['Zip (analysis)', 'Zip']);
check('a leading zero survives through the analysis zip',
  prwSiteListRows({ headers: ['Site', 'Zip', 'Zip (analysis)'], rows: [{ Site: 'A', Zip: 2458, 'Zip (analysis)': '02458' }] })[0].zip.value,
  '02458');
check('electric spend', src.electricSpend, ['Total Electric Cost']);
check('gas spend', src.gasSpend, ['Total Natural Gas Cost']);
check('Estimated Values is never a source',
  Object.values(src).flat().includes('Estimated Values'), false);
check('analysis column renamed around a collision is still found',
  prwSourceColumns(['Site', 'Total Electric Cost', 'Total Electric Cost (analysis)']).electricSpend,
  ['Total Electric Cost', 'Total Electric Cost (analysis)']);

// --- rows --------------------------------------------------------------
const rows = prwSiteListRows(list);
check('blank site names are skipped', rows.length, 2);
const [nw, au] = rows;
check('row shape follows PRW columns', Object.keys(nw), PRW_COLUMNS.map(c => c.key));
check('actual electric usage', nw.electricUsage, { value: 500000, estimated: false });
check('actual electric spend', nw.electricSpend, { value: 98000, estimated: false });
check('estimated gas usage', nw.gasUsage, { value: 1200, estimated: true });
check('estimated gas spend', nw.gasSpend, { value: 14400, estimated: true });
check('zip kept as text', nw.zip, { value: '02458', estimated: false });
check('accounts from property type are estimated', nw.electricAccounts.estimated, true);
check('accounts from property type are numbers', typeof nw.electricAccounts.value, 'number');
check('city falls back to the analysis column', au.city, { value: 'Austin', estimated: false });
check('text money parsed to a number', au.electricSpend, { value: 1250, estimated: false });
check('missing usage is null, not zero', au.electricUsage, { value: null, estimated: false });
check('unknown property type leaves accounts blank', au.electricAccounts, { value: null, estimated: false });

// The upload's own account counts win over the estimate and read actual.
const own = prwSiteListRows({
  headers: ['Site', 'Property Type', 'Electric Accounts', 'Gas Accounts'],
  rows: [{ Site: 'A', 'Property Type': 'Office', 'Electric Accounts': 3, 'Gas Accounts': '' }],
})[0];
check('uploaded electric accounts are actual', own.electricAccounts, { value: 3, estimated: false });
check('blank gas accounts fall back to the estimate', own.gasAccounts.estimated, true);

check('tally', prwEstimateTally(rows), { estimated: 4, actual: 3 });
check('toNumber', [toNumber('12,000 kWh'), toNumber('n/a'), toNumber(7)], [12000, null, 7]);
check('filename', prwSiteListFilename('Acme, Inc.', new Date('2026-10-28T12:00:00Z')),
  'Acme_Inc_PRW_Site_List_2026-10-28.xlsx');

// --- workbook ----------------------------------------------------------
const { wb } = buildPrwSiteListWorkbook(ExcelJS.Workbook, list, 'Acme');
const ws = wb.getWorksheet('PRW Site List');
check('header row is the PRW template',
  PRW_COLUMNS.map((_, i) => ws.getRow(1).getCell(i + 1).value),
  ['Site Name', 'Address', 'City', 'State', 'Zip Code', 'Country',
    'Electric Power Spend', 'Electric Power Usage', 'Electric Power Accounts',
    'Natural Gas Spend', 'Natural Gas Usage', 'Natural Gas Accounts']);
check('header bold + underlined', [ws.getCell('A1').font.bold, ws.getCell('A1').font.underline], [true, true]);
check('estimated cell italic', ws.getCell('K2').font.italic, true);
check('actual cell upright', !!ws.getCell('H2').font.italic, false);
check('number stays a number', ws.getCell('G2').value, 98000);
check('legend sheet present', !!wb.getWorksheet('Legend'), true);

// --- Facilities & Accounts tab ------------------------------------------
const regionRows = prwSiteListRows({
  headers: ['Site', 'Country', 'State', 'Electric Accounts', 'Gas Accounts', 'Property Type'],
  rows: [
    { Site: 'Boston', Country: 'United States', 'Electric Accounts': 2, 'Gas Accounts': 1 },
    { Site: 'Austin', Country: '', State: 'TX', 'Electric Accounts': 1, 'Gas Accounts': '', 'Property Type': 'Office' },
    { Site: 'Toronto', Country: 'Canada', 'Electric Accounts': 1, 'Gas Accounts': 1 },
    { Site: 'Lyon', Country: 'France', 'Electric Accounts': 3, 'Gas Accounts': 2 },
    { Site: 'Shanghai', Country: 'China', 'Electric Accounts': 1, 'Gas Accounts': 0 },
    { Site: 'Somewhere', Country: '', State: '', 'Electric Accounts': 5 },
  ],
});
const sum = prwRegionSummary(regionRows);
check('facilities by region', sum.facilities, { 'North America': 3, Europe: 1, 'Rest of World': 1 });
check('power accounts by region', sum.power, { 'North America': 4, Europe: 3, 'Rest of World': 1 });
check('a state with no country counts as North America', sum.facilities['North America'], 3);
check('a site with no country or state is left out, and counted', sum.unplaced, 1);
check('NA gas includes an estimated account', sum.gasEstimated['North America'], true);
check('Europe gas is all actual', sum.gasEstimated.Europe, false);

const sumWs = wb.getWorksheet('Facilities & Accounts');
check('summary tab exists, second', wb.worksheets.map(w => w.name), ['PRW Site List', 'Facilities & Accounts', 'Legend']);
check('summary header', [sumWs.getCell('A1').value, sumWs.getCell('C1').value, sumWs.getCell('D1').value, sumWs.getCell('E1').value],
  ['Country/Region →', 'North America', 'Europe', 'ROW']);
check('summary service labels', [sumWs.getCell('B3').value, sumWs.getCell('B4').value, sumWs.getCell('B11').value],
  ['Power', 'Natural Gas', 'Total']);
check('facilities filled from the site rows', sumWs.getCell('C2').value, 2);
check('total is a live SUM', sumWs.getCell('C11').value.formula, 'SUM(C3:C10)');

console.log(`${failed ? 'FAIL' : 'PASS'} prwSiteListExport: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
