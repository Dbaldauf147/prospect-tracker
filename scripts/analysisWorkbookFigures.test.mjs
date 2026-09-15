// Assertion tests for reading a company's headline savings back out of its
// saved Master Analysis workbook. Plain Node - no test framework (the
// project has none). Run:
//   node scripts/analysisWorkbookFigures.test.mjs
//
// The point of most of these is the round trip. The workbook is WRITTEN by
// exceljs (SitesView) and READ by SheetJS (the company popup), and the
// figure is a formula whose cached result is the only thing available
// offline - so a test that only exercised a hand-built workbook object would
// pass while the real thing returned nothing.
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { annualSavingsFromWorkbook, annualSavingsInSheet } from '../src/utils/analysisWorkbookFigures.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const ANNUAL = 'Total Indicative Annual Savings (Electric + Natural Gas)';
const CUMULATIVE = 'Total Indicative Cumulative Savings over the Term (Electric + Natural Gas)';

// Build a workbook the way SitesView builds the two places this figure
// lands, and read it back the way the popup does.
async function roundTrip(build) {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const buf = await wb.xlsx.writeBuffer();
  return XLSX.read(new Uint8Array(buf), { type: 'array' });
}

// --- the Summary sheet, as savingsFigure() writes it ---------------------
{
  // Label merged across A:E, value merged from F, both rows present - the
  // annual one and the cumulative one under it.
  const read = await roundTrip((wb) => {
    const ws = wb.addWorksheet('Summary');
    ws.mergeCells(5, 1, 5, 5);
    ws.getCell(5, 1).value = ANNUAL;
    ws.mergeCells(5, 6, 5, 12);
    ws.getCell(5, 6).value = { formula: "'Indicative Savings'!$J$40", result: 1435951 };
    ws.mergeCells(6, 1, 6, 5);
    ws.getCell(6, 1).value = CUMULATIVE;
    ws.mergeCells(6, 6, 6, 12);
    ws.getCell(6, 6).value = { formula: "'Indicative Savings'!$J$41", result: 4307853 };
  });
  eq(annualSavingsFromWorkbook(read), 1435951,
    'the headline is read off the Summary sheet through a formula cache');
}

// --- the Savings Summary band on the Indicative Savings sheet ------------
{
  // No Summary sheet at all, so the search has to fall through to the big
  // scenario sheet - and the band sits wherever the tables above it end,
  // which is why nothing here is pinned to a row.
  const read = await roundTrip((wb) => {
    const ws = wb.addWorksheet('Indicative Savings');
    ws.getCell(1, 1).value = 'Electric Power';
    ws.getCell(38, 1).value = 'Savings Summary';
    ws.mergeCells(39, 1, 39, 9);
    ws.getCell(39, 1).value = ANNUAL;
    ws.getCell(39, 10).value = { formula: 'J20+J31', result: 880400 };
  });
  eq(annualSavingsFromWorkbook(read), 880400,
    'and off the Indicative Savings band when there is no Summary sheet');
}

// --- the cumulative figure is not the annual one -------------------------
{
  // The two labels differ by one word and the cumulative row sits directly
  // under the annual one. A matcher that keyed on "Total Indicative" would
  // return the term total as the annual figure - three to five times too
  // big, on a field that prints straight onto the company card.
  const read = await roundTrip((wb) => {
    const ws = wb.addWorksheet('Summary');
    ws.getCell(5, 1).value = CUMULATIVE;
    ws.getCell(5, 6).value = 4307853;
    ws.getCell(6, 1).value = ANNUAL;
    ws.getCell(6, 6).value = 1435951;
  });
  eq(annualSavingsFromWorkbook(read), 1435951,
    'the cumulative row is not mistaken for the annual one, even above it');
}

// --- a workbook with no savings in it ------------------------------------
{
  const read = await roundTrip((wb) => {
    const ws = wb.addWorksheet('Site Detail');
    ws.getCell(1, 1).value = 'Site Name';
    ws.getCell(2, 1).value = 'Houston DC';
  });
  eq(annualSavingsFromWorkbook(read), null,
    'a workbook that carries no headline answers null');
}

// --- a run that priced nothing -------------------------------------------
{
  // The save itself only ever stamps a positive figure, so that a run which
  // priced nothing cannot blank a number somebody typed. Reading the
  // workbook back has to honour the same rule.
  const read = await roundTrip((wb) => {
    const ws = wb.addWorksheet('Summary');
    ws.getCell(5, 1).value = ANNUAL;
    ws.getCell(5, 6).value = 0;
  });
  eq(annualSavingsFromWorkbook(read), null, 'a zero headline is not a figure to stamp');
}

// --- a plain literal, not a formula --------------------------------------
{
  // SitesView writes a bare number instead of a formula when neither
  // commodity section produced a total cell to sum.
  const read = await roundTrip((wb) => {
    const ws = wb.addWorksheet('Summary');
    ws.getCell(5, 1).value = ANNUAL;
    ws.getCell(5, 6).value = 612000;
  });
  eq(annualSavingsFromWorkbook(read), 612000, 'a literal value reads the same as a cached one');
}

// --- Summary wins when both sheets carry a figure ------------------------
{
  const read = await roundTrip((wb) => {
    const big = wb.addWorksheet('Indicative Savings');
    big.getCell(39, 1).value = ANNUAL;
    big.getCell(39, 10).value = 111;
    const sum = wb.addWorksheet('Summary');
    sum.getCell(5, 1).value = ANNUAL;
    sum.getCell(5, 6).value = 222;
  });
  eq(annualSavingsFromWorkbook(read), 222, 'the Summary sheet is asked first');
}

// --- the shape of the search, without a file ------------------------------
{
  // Cheap pins on the rule itself: the first number to the right of the
  // label wins, blanks between them are stepped over, and text to the right
  // is not a figure.
  eq(annualSavingsInSheet({
    '!ref': 'A5:H5',
    A5: { t: 's', v: ANNUAL },
    D5: { t: 's', v: 'USD' },
    F5: { t: 'n', v: 1435951.4 },
  }), 1435951, 'text to the right is stepped over, and the figure is rounded');

  eq(annualSavingsInSheet({ '!ref': 'A5:H5', A5: { t: 's', v: ANNUAL } }), null,
    'a label with nothing beside it is not a figure');

  eq(annualSavingsInSheet({}), null, 'a sheet with no used range answers null');
  eq(annualSavingsFromWorkbook(null), null, 'and no workbook answers null');
  eq(annualSavingsFromWorkbook({ SheetNames: [], Sheets: {} }), null, 'as does an empty one');

  // Case and spacing in the label are the workbook's, not ours to depend on.
  eq(annualSavingsInSheet({
    '!ref': 'A1:B1',
    A1: { t: 's', v: 'total indicative   annual savings' },
    B1: { t: 'n', v: 500 },
  }), 500, 'the label match is not fussy about case or spacing');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
