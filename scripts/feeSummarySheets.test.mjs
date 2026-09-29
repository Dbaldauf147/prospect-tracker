// Fee Summary and Pricing vs Fee Builder sheets, shared by the Fee Margin
// Excel and the Fee Builder export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import exceljs from 'exceljs';
import { compareFeeSchedules, addFeeSummarySheet, addFeeComparisonSheet } from '../src/utils/feeSummarySheets.js';

const pricing = [
  { name: 'Per account', type: 'Recurring (monthly)', feePerUnit: 1.68, unit: 'Per Account', unitCount: 519, startMonth: 4, years: [100, 200], term: 300, cost: 150 },
  { name: 'Program fee', type: 'Recurring (monthly)', feePerUnit: 3000, unit: 'Fixed', unitCount: 1, startMonth: 1, years: [36000, 36000], term: 72000, cost: 30000 },
  { name: 'Cass setup', type: 'Setup', feePerUnit: 9.5, unit: 'Per Account', unitCount: 519, startMonth: 1, years: [4930.5, 0], term: 4930.5, cost: 2000 },
];
const builder = [
  pricing[0],
  { ...pricing[1], feePerUnit: 3100, years: [37200, 37200], term: 74400 },
  { name: 'Per site benchmarking', type: 'Recurring (monthly)', feePerUnit: 42.92, unit: 'Per Site', unitCount: 29, startMonth: 1, years: [1, 1], term: 2, cost: 1 },
];

test('fees are matched by name and every delta is named', () => {
  const c = compareFeeSchedules(pricing, builder);
  assert.deepEqual(c.map(x => [x.name, x.status]), [
    ['Per account', 'Match'],
    ['Program fee', 'Differs: Fee, Term fees'],
    ['Cass setup', 'Only on Pricing tab'],
    ['Per site benchmarking', 'Only in Fee Builder'],
  ]);
  assert.equal(c[1].feeDelta, 100);
  assert.equal(c[1].termDelta, 2400);
  assert.equal(c[2].termDelta, -4930.5);
  assert.equal(c[2].costDelta, -2000);
});

test('two rows with one fee name are one fee line', () => {
  const rows = [{ ...pricing[1], term: 10, cost: 4 }, { ...pricing[1], term: 5, cost: 1 }];
  const [c] = compareFeeSchedules(rows, [{ ...pricing[1], term: 15, cost: 5, unitCount: 2 }]);
  assert.equal(c.status, 'Match');
});

test('the sheets write the summary columns and the comparison', async () => {
  const wb = new exceljs.Workbook();
  addFeeSummarySheet(wb, { rows: pricing, subtitle: 'Option 1' });
  addFeeComparisonSheet(wb, {
    pricing: { rows: pricing, totals: { feeByYear: [41030.5, 36200], costByYear: [20000, 15000], margin: { finalMargin: 0.5 } } },
    builder: { rows: builder, totals: { feeByYear: [37301, 37201], costByYear: [20000, 15000], margin: { finalMargin: 0.52 } } },
    numYears: 2,
    subtitle: 'Option 1',
  });
  const buf = await wb.xlsx.writeBuffer();
  const back = new exceljs.Workbook();
  await back.xlsx.load(buf);
  const s = back.getWorksheet('Fee Summary');
  assert.deepEqual(s.getRow(3).values.slice(1), ['Fee line item', 'Type', 'Fee', 'Unit', 'Units', 'Start Month']);
  assert.deepEqual(s.getRow(4).values.slice(1), ['Per account', 'Recurring (monthly)', 1.68, 'Per Account', 519, 4]);
  assert.equal(s.getCell(4, 3).numFmt, '$#,##0.00');
  const c = back.getWorksheet('Pricing vs Fee Builder');
  const text = [];
  c.eachRow(r => text.push(r.values.filter(v => v != null).join('|')));
  assert.ok(text.some(t => t.startsWith('Fees, delta|-3729.5|1001|-2728.5')), text.join('\n'));
  assert.ok(text.some(t => t.startsWith('Program fee|') && t.endsWith('Differs: Fee, Term fees')));
  assert.ok(text.some(t => t.startsWith('Per site benchmarking|') && t.endsWith('Only in Fee Builder')));
});
