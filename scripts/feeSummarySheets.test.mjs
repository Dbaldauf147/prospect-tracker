// Fee Summary, Cost deltas and Fee deltas sheets, shared by the Fee Margin
// Excel and the Fee Builder export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import exceljs from 'exceljs';
import { compareFeeSchedules, compareCostLines, addFeeSummarySheet, addFeeComparisonSheet } from '../src/utils/feeSummarySheets.js';

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

const costLines = [
  { lineItem: 'Program ops', type: 'Recurring (monthly)', pricingFee: 'Program fee', builderFee: 'Program fee', pricedInto: 'Program fee', byYear: [15000, 15000] },
  { lineItem: 'CASS data', type: 'Recurring (monthly)', pricingFee: 'Per account', builderFee: null, pricedInto: 'Per account monthly', byYear: [2000, 0] },
  { lineItem: 'Stray', type: 'One Time', pricingFee: null, builderFee: null, pricedInto: null, byYear: [50, 0] },
];

test('cost lines say which fee each side logs them on', () => {
  const c = compareCostLines(costLines);
  assert.deepEqual(c.map(x => [x.lineItem, x.pricing, x.builder, x.delta, x.match]), [
    ['Program ops', 30000, 30000, 0, true],
    ['CASS data', 2000, 0, -2000, false],
    ['Stray', 0, 0, 0, true],
  ]);
  assert.equal(c[1].status, 'Only on Pricing tab; priced into "Per account monthly" but not logged on it');
  assert.equal(c[2].status, 'On no fee in either');
  assert.equal(compareCostLines([{ ...costLines[0], builderFee: 'Other' }])[0].status, 'On a different fee');
});

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
    builder: { rows: builder, totals: { feeByYear: [37301, 37201], costByYear: [18000, 15000], margin: { finalMargin: 0.52 } } },
    costLines,
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
  assert.equal(back.getWorksheet('Pricing vs Fee Builder'), undefined);
  const lines = (name) => {
    const out = [];
    back.getWorksheet(name).eachRow(r => out.push(r.values.filter(v => v != null).join('|')));
    return out;
  };
  const fees = lines('Fee deltas');
  assert.ok(fees.some(t => t.startsWith('Fees, delta|-3729.5|1001|-2728.5')), fees.join('\n'));
  // Fees only: the Program fee's cost is the same, its fee is not.
  assert.ok(fees.some(t => t.startsWith('Program fee|') && t.endsWith('Differs: Fee, Term fees')));
  assert.ok(fees.some(t => t.startsWith('Per site benchmarking|') && t.endsWith('Only in Fee Builder')));
  assert.ok(!fees.some(t => /Term cost/.test(t)));
  const costs = lines('Cost deltas');
  assert.ok(costs.some(t => t.startsWith('Cost, delta|-2000|0|-2000')), costs.join('\n'));
  // Biggest delta first.
  const first = costs.findIndex(t => t.startsWith('CASS data|'));
  assert.ok(first > 0 && first < costs.findIndex(t => t.startsWith('Program ops|')));
  assert.ok(costs[first].includes('priced into "Per account monthly" but not logged on it'));
  assert.ok(costs.some(t => t.startsWith('Total|') && t.includes('|-2000')));
});

test('condensed Fee Summary folds lines with the same name and structure', async () => {
  const m = (name, fee, unit, units, start, type = 'Recurring (monthly)') => ({ name, type, feePerUnit: fee, unit, unitCount: units, startMonth: start });
  const rows = [
    m('Per account monthly', 1, 'Per Account', 519, 4),
    m('Per account monthly', 0.23, 'Per Account', 519, 4),
    m('Per account monthly', 0.42, 'Per Account', 519, 1),
    m('Program fee', 146.94, 'Fixed', 1, 1),
    m('Program fee', 15.13, 'Fixed', 1, 1),
    m('Direct Bill Payment Setup', 9.32, 'Per Account', 519, 1, 'Setup'),
    m('Program monthly', 2725.64, 'Fixed', 1, 1),
    m('Program monthly', 55.97, 'Fixed', 1, 1),
    m('program monthly ', 143.71, 'Fixed', 1, 1),
    m('ESPM Link per site', 1.56, 'Per Site', 29, 1),
    m('BBS per site', 1224.69, 'Per Site', 1, 1),
  ];
  const wb = new exceljs.Workbook();
  addFeeSummarySheet(wb, { rows, subtitle: 'Option 1', condense: true });
  const back = new exceljs.Workbook();
  await back.xlsx.load(await wb.xlsx.writeBuffer());
  const s = back.getWorksheet('Fee Summary');
  const body = [];
  s.eachRow((r, i) => { if (i > 3) body.push(r.values.slice(1)); });
  assert.deepEqual(body, [
    ['Per account monthly', 'Recurring (monthly)', 1.23, 'Per Account', 519, 4],
    ['Per account monthly', 'Recurring (monthly)', 0.42, 'Per Account', 519, 1],
    ['Program fee', 'Recurring (monthly)', 162.07, 'Fixed', 1, 1],
    ['Direct Bill Payment Setup', 'Setup', 9.32, 'Per Account', 519, 1],
    ['Program monthly', 'Recurring (monthly)', 2925.32, 'Fixed', 1, 1],
    ['ESPM Link per site', 'Recurring (monthly)', 1.56, 'Per Site', 29, 1],
    ['BBS per site', 'Recurring (monthly)', 1224.69, 'Per Site', 1, 1],
  ]);
});

test('without condense every line keeps its own row', async () => {
  const row = { name: 'Program fee', type: 'Recurring (monthly)', feePerUnit: 10, unit: 'Fixed', unitCount: 1, startMonth: 1 };
  const wb = new exceljs.Workbook();
  addFeeSummarySheet(wb, { rows: [row, row] });
  assert.equal(wb.getWorksheet('Fee Summary').rowCount, 5);
});
