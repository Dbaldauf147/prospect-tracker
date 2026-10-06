// Assertion tests for the Master Analysis tab picker's pruning: unticked
// tabs leave the workbook, and nothing left behind breaks because of it.
// Plain Node, no framework. Run:
//   node scripts/masterAnalysisTabs.test.mjs
import ExcelJS from 'exceljs';
import {
  MASTER_ANALYSIS_TAB_NAMES,
  normalizeTabSelection,
  pruneMasterAnalysisTabs,
} from '../src/utils/masterAnalysisTabs.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

function build() {
  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet('Summary');
  wb.addWorksheet('NAM').getCell('A1').value = 7;
  const scen = wb.addWorksheet('Indicative Savings');
  scen.getCell('J5').value = 1234;
  wb.addWorksheet('Site List').getCell('A1').value = 'Site';
  wb.addWorksheet('Some Future Tab');
  wb.addWorksheet('__rt_state__', { state: 'hidden' }).getCell('A1').value = '{}';
  summary.getCell('F5').value = { formula: "'Indicative Savings'!$J$5", result: 1234 };
  summary.getCell('F6').value = { formula: 'NAM!A1*2', result: 14 };
  summary.getCell('F7').value = { formula: 'SUM(1,2)', result: 3 };
  summary.getCell('A1').value = { text: 'Go to site list', hyperlink: "#'Site List'!A1" };
  return wb;
}

{
  const wb = build();
  const removed = pruneMasterAnalysisTabs(wb, ['Summary']);
  eq(removed, ['NAM', 'Indicative Savings', 'Site List'], 'unticked catalogued tabs are removed');
  eq(wb.worksheets.map(w => w.name), ['Summary', 'Some Future Tab', '__rt_state__'],
    'uncatalogued and hidden sheets survive');
  const s = wb.getWorksheet('Summary');
  eq(s.getCell('F5').value, 1234, 'quoted reference to a removed tab is frozen to its value');
  eq(s.getCell('F6').value, 14, 'bare reference to a removed tab is frozen to its value');
  eq(s.getCell('F7').value, { formula: 'SUM(1,2)', result: 3 }, 'unrelated formula is untouched');
  eq(s.getCell('A1').value, 'Go to site list', 'link to a removed tab becomes plain text');
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  eq(back.worksheets.map(w => w.name), ['Summary', 'Some Future Tab', '__rt_state__'], 'pruned workbook writes and reloads');
}

{
  const wb = build();
  const removed = pruneMasterAnalysisTabs(wb, MASTER_ANALYSIS_TAB_NAMES);
  eq(removed, [], 'everything ticked removes nothing');
  eq(wb.getWorksheet('Summary').getCell('F5').value.formula, "'Indicative Savings'!$J$5", 'formulas kept when their tab stays');
}

eq(normalizeTabSelection(null).length, MASTER_ANALYSIS_TAB_NAMES.length, 'no saved selection means every tab');
eq(normalizeTabSelection(['Site List', 'Retired Tab', 'Summary']), ['Summary', 'Site List'], 'saved selection is cleaned and ordered');
eq(new Set(MASTER_ANALYSIS_TAB_NAMES).size, MASTER_ANALYSIS_TAB_NAMES.length, 'tab names are unique');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
