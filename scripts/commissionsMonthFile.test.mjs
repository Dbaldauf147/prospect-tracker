// Commissions > Monthly: reading a commissions Excel file dropped on a month.
// Run:
//   node scripts/commissionsMonthFile.test.mjs
import {
  autoMapCommissionHeader, gridFromSheetRows, commissionMonthlyTotals, isCommissionsFileName,
} from '../src/utils/commissionsMonthFile.js';
import { asNumber } from '../src/utils/dealsFormat.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const MARCH = 2;

// Headers that name their destination map the same with or without a month.
eq(autoMapCommissionHeader('Project Name'), 'Project Name', 'canonical header, no month');
eq(autoMapCommissionHeader('Project Name', MARCH), 'Project Name', 'canonical header, dropped on a month');
eq(autoMapCommissionHeader('1/1/2026 Revenue'), 'January Revenue', 'legacy m/1/yyyy Revenue');
eq(autoMapCommissionHeader('1/1/2026'), 'January', 'legacy m/1/yyyy commission');
eq(autoMapCommissionHeader('FY2026 Revenue'), 'FY Revenue', 'FY revenue');
eq(autoMapCommissionHeader('Jan-26'), 'January', 'Excel Jan-26 month header');
eq(autoMapCommissionHeader('Sept 2026 Revenue'), 'September Revenue', 'Sept 2026 Revenue');
eq(autoMapCommissionHeader('Ju 2026'), '', 'two-letter month word is not a month');
eq(autoMapCommissionHeader('April', MARCH), 'April', 'a month-named column keeps its own month');

// Generic columns only map when the file was dropped on a month.
eq(autoMapCommissionHeader('Commission'), '', 'generic Commission, no month: skipped');
eq(autoMapCommissionHeader('Commission', MARCH), 'March', 'generic Commission -> dropped month');
eq(autoMapCommissionHeader('Commission Amount', MARCH), 'March', 'Commission Amount -> dropped month');
eq(autoMapCommissionHeader('Revenue', MARCH), 'March Revenue', 'generic Revenue -> dropped month revenue');
eq(autoMapCommissionHeader('Commission %', MARCH), '%', 'commission rate is the % column');
eq(autoMapCommissionHeader('Project', MARCH), 'Project Name', 'Project -> Project Name');
eq(autoMapCommissionHeader('Client', MARCH), 'Account Name', 'Client -> Account Name');
eq(autoMapCommissionHeader('YTD Commission', MARCH), '', 'year-to-date figures are not the month');
eq(autoMapCommissionHeader('Notes', MARCH), '', 'unrelated column skipped');

// Header row found under a title block; blank rows dropped; short rows padded.
const grid = gridFromSheetRows([
  ['March 2026 Commission Statement'],
  [],
  ['Project', 'Client', 'Revenue', 'Commission'],
  ['Griffis Am 5', 'Griffis Residential', 10000, 500],
  ['', '', '', ''],
  ['Prologis SoW 7', 'Prologis', 2000],
], MARCH);
eq(grid.headers, ['Project', 'Client', 'Revenue', 'Commission'], 'header row found below the title');
eq(grid.rows, [['Griffis Am 5', 'Griffis Residential', 10000, 500], ['Prologis SoW 7', 'Prologis', 2000, '']], 'data rows, blank dropped, short padded');
eq(gridFromSheetRows([]), { headers: [], rows: [] }, 'empty sheet');

// Totals per month, ignored rows left out.
const totals = commissionMonthlyTotals([
  { 'Project Name': 'A', March: '$500', 'March Revenue': '10,000' },
  { 'Project Name': 'B', March: 250, April: 0 },
  { 'Project Name': 'C', March: 999, __ignored: true },
], asNumber);
eq(totals[MARCH], { month: 'March', commission: 750, revenue: 10000, paidRows: 2, rows: 2 }, 'March totals');
eq(totals[3], { month: 'April', commission: 0, revenue: 0, paidRows: 0, rows: 0 }, 'a zero cell is not a paid row');

eq(['a.xlsx', 'b.XLS', 'c.csv', 'd.pdf'].map(isCommissionsFileName), [true, true, true, false], 'file types');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
