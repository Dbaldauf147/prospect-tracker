// The "Export PE Decision Makers" workbook: SE layout, one row per
// decision maker grouped by firm, and a second sheet for firms with none.
// Plain Node. Run: node scripts/peDecisionMakersWorkbook.test.mjs
import { buildPeDecisionMakersWorkbook, PE_DM_COLUMNS } from '../src/utils/peDecisionMakersWorkbook.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}
const cellText = (v) => (v && typeof v === 'object' ? v.text : v);

const wb = await buildPeDecisionMakersWorkbook({
  rows: [
    { firm: 'Blue Owl', peStage: 'Discovery', cdm: 'Dan Baldauf', name: 'Dan Egan', title: 'MD', email: 'dan@blueowl.com', linkedin: 'linkedin.com/in/x', primaryPoc: 'Yes' },
    { firm: 'Blue Owl', peStage: 'Discovery', cdm: 'Dan Baldauf', name: 'Ann Lee', title: 'VP' },
    { firm: 'KKR', peStage: 'Lead', cdm: '', name: 'Bo Kim' },
  ],
  firmsWithout: [{ firm: 'Apollo', peStage: 'Lead', cdm: '' }],
  firmCount: 3,
});
const [ws, ws2] = wb.worksheets;
eq(wb.worksheets.map(w => w.name), ['PE Decision Makers', 'Firms Without a DM'], 'two sheets');
eq(ws.getCell(1, 1).value, 'Schneider Electric', 'SE title band');
eq(ws.getCell(1, 1).fill.fgColor.argb, 'FF3DCD58', 'SE green');
eq(ws.getCell(2, 1).value, 'PE Decision Makers · 3 contacts at 2 of 3 PE firms', 'subtitle counts');
eq(ws.getRow(3).values.slice(1), PE_DM_COLUMNS.map(c => c.label), 'header row');
eq(ws.getCell(3, 1).fill.fgColor.argb, 'FF009530', 'dark green header');
eq(ws.getCell(4, 4).value, 'Dan Egan', 'first contact');
eq(ws.getCell(4, 6).value.hyperlink, 'mailto:dan@blueowl.com', 'email links');
eq(ws.getCell(4, 9).value.hyperlink, 'https://linkedin.com/in/x', 'LinkedIn links');
eq(ws.getCell(4, 11).value, 'Yes', 'primary POC column');
eq(ws.getCell(4, 1).fill, undefined, 'first firm unbanded');
eq(ws.getCell(5, 1).fill, undefined, 'same firm same band');
eq(ws.getCell(6, 1).fill.fgColor.argb, 'FFF1F8F4', 'next firm banded');
eq(cellText(ws2.getCell(4, 1).value), 'Apollo', 'firm without DM listed');

console.log(failed === 0 ? `\nAll ${passed} peDecisionMakersWorkbook tests passed.` : `\n${failed} test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
