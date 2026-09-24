// Assertion tests for the savings-by-category workbook: Step by step's last
// step, a tab per category, month by month.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/savingsCategoriesExport.test.mjs
//
// Pinned: a tab per category with the months of the term; each tab's months
// sum to the total the page shows for that category; every figure is a
// number, not a string; the adder split adds back up to the saving.
import {
  categoryRuns, categoryMonthAoa, categoryHeaders, categoryFormats, summaryRows, summaryAoa,
  categoriesFilename, CATEGORY_SHEET, BASELINE_LABEL, buildSavingsCategoriesWorkbook, SE,
} from '../src/utils/savingsCategoriesExport.js';
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import {
  normalizeScenario, monthlySeries, forwardSeries, normalizeSettles, SHIPPED_SETTLES, SHIPPED_FORWARD,
} from '../src/utils/nymexSavings.js';
import { compareOption } from '../src/utils/sourcingSteps.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; } else { failed++; console.error(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }
function near(actual, expected, tol, name) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) { passed++; }
  else { failed++; console.error(`FAIL  ${name}\n        expected ${expected} ±${tol}\n        got      ${actual}`); }
}

const series = monthlySeries(normalizeSettles(SHIPPED_SETTLES));
const curve = forwardSeries(SHIPPED_FORWARD);
const scenario = normalizeScenario({
  name: 'Syracuse Main (SYR)', startYear: 2025, startMonth: 12, termMonths: 12,
  annualVolumeDth: 53297, basis: 0, adder: -0.276, contractType: 'index',
  currentRate: 3.51, currentAdder: null, noActionPct: 4, strategyPct: 1,
}, series, curve);

const runs = categoryRuns(scenario, series, curve);
eq(Object.keys(runs), ['index', 'contract', 'avoided'], 'a run for every category');
eq(Object.values(CATEGORY_SHEET).every(n => n.length <= 31 && !/[\\/?*[\]:]/.test(n)), true, 'every tab name is one Excel accepts');

{
  // The same figures step 5 shows.
  const shown = compareOption(scenario, series, curve, 'savingsBasis', ['index', 'contract', 'avoided']);
  for (const key of Object.keys(runs)) {
    near(runs[key].totals.saving, shown[key].saving, 1e-6, `${key}: the workbook's total is the one on step 5`);
  }
}

for (const key of Object.keys(runs)) {
  const aoa = categoryMonthAoa(key, runs[key]);
  const [head, ...rest] = aoa;
  const months = rest.slice(0, -1);
  const total = rest[rest.length - 1];
  eq(months.length, 12, `${key}: a row per month of the term`);
  eq(head.length, categoryFormats(key, scenario).length, `${key}: a format for every column`);
  eq(total[0], 'Term total', `${key}: ends on the term total`);
  const col = (h) => head.indexOf(h);
  const sum = (c) => months.reduce((n, r) => n + r[c], 0);
  near(sum(col('Saving')), total[col('Saving')], 1e-6, `${key}: the months sum to the total`);
  near(months[months.length - 1][col('Running saving')], total[col('Saving')], 1e-6, `${key}: the running saving ends on the total`);
  ok(months.every(r => [2, 4, 5, 6, 7, 8, 9, 10].every(c => typeof r[c] === 'number')), `${key}: every figure is a number`);
  ok(head.includes(`${BASELINE_LABEL[key]} cost`), `${key}: the baseline is named for what it is`);
  months.forEach((r, i) => {
    if (i === 0) near(r[col(`${BASELINE_LABEL[key]} cost`)] - r[col('Contract 2 cost')], r[col('Saving')], 1e-6, `${key}: saving is baseline less contract`);
  });
}

{
  const coc = categoryMonthAoa('contract', runs.contract);
  ok(coc[1].every((v, i) => i < 2 || i === 3 || typeof v === 'number'), 'contract over contract rows are numbers');
  near(coc[1][6], 3.51, 1e-12, 'contract over contract is measured against Contract 1 every month');
  eq(categoryHeaders('contract', scenario).includes('Retail adder saving'), false, 'no adder split without Contract 1\'s adder');

  const withAdder = categoryRuns({ ...scenario, currentAdder: 0.1 }, series, curve);
  const aoa = categoryMonthAoa('contract', withAdder.contract);
  const h = aoa[0];
  ok(h.includes('Retail adder saving') && h.includes('Commodity and basis saving'), 'with it, the adder split gets two columns');
  const last = aoa[aoa.length - 1];
  near(last[h.indexOf('Retail adder saving')], (0.1 - -0.276) * withAdder.contract.totals.volume, 1e-6, 'the adder saving is (adder 1 - adder 2) x volume');
  near(last[h.indexOf('Retail adder saving')] + last[h.indexOf('Commodity and basis saving')], last[h.indexOf('Saving')], 1e-6, 'and the split adds back up');
  eq(categoryHeaders('index', { ...scenario, currentAdder: 0.1 }).includes('Retail adder saving'), false, 'the split is only on the contract tab');
}

{
  const rows = summaryRows(runs);
  const row = (label) => rows.find(r => r.label === label);
  eq(row('Category').values, ['Against the index', 'Contract Over Contract', 'Cost Avoidance'], 'the summary puts the three side by side');
  near(row('Saving over the term').values[1], runs.contract.totals.saving, 1e-6, 'with each one\'s saving');
  eq(row('Site').values, ['Syracuse Main (SYR)'], 'and names the site');
  eq(row('Contract 1 retail adder ($/Dth)').values, ['not given'], 'an unknown Contract 1 adder says so');
  ok(summaryAoa(runs).every(r => r.every(v => typeof v !== 'string' || !v.includes('—'))), 'no em dashes in the summary');
}

eq(categoriesFilename('Syracuse Main (SYR)', new Date('2026-09-24T12:00:00Z')), 'Syracuse_Main_SYR_savings_by_category_2026-09-24.xlsx', 'a safe, dated filename');
eq(categoriesFilename('', new Date('2026-09-24T12:00:00Z')), 'site_savings_by_category_2026-09-24.xlsx', 'an unnamed site still gets one');

// ── The Schneider Electric formatted workbook ──
{
  const wb = buildSavingsCategoriesWorkbook(ExcelJS.Workbook, categoryRuns({ ...scenario, currentAdder: 0.1 }, series, curve));
  eq(wb.worksheets.map(w => w.name), ['Summary', 'Against the index', 'Contract Over Contract', 'Cost Avoidance'], 'Summary first, then a tab per category');
  eq(wb.creator, 'Schneider Electric · Prospect Tracker', 'authored as the other branded exports are');
  for (const ws of wb.worksheets) {
    const title = ws.getCell(1, 1);
    eq(title.value, 'Schneider Electric', `${ws.name}: the title band`);
    eq(title.fill?.fgColor?.argb, SE.GREEN, `${ws.name}: in Life Is On green`);
    eq(ws.getCell(3, 1).fill?.fgColor?.argb, SE.GREEN_DARK, `${ws.name}: dark green header row`);
    eq(ws.getCell(3, 1).font?.color?.argb, SE.WHITE, `${ws.name}: with white header text`);
    eq(ws.properties.tabColor?.argb, SE.GREEN, `${ws.name}: a green tab`);
    eq(ws.views[0].showGridLines, false, `${ws.name}: no gridlines`);
    eq(ws.views[0].ySplit, 3, `${ws.name}: frozen under the header`);
    ok(String(ws.getCell(2, 1).value).startsWith('Syracuse Main (SYR)'), `${ws.name}: the subtitle names the site`);
    // Every populated cell is left-aligned, headers and numbers alike.
    const notLeft = [];
    ws.eachRow((row) => row.eachCell((cell) => {
      if (cell.alignment?.horizontal !== 'left') notLeft.push(cell.address);
    }));
    eq(notLeft, [], `${ws.name}: every cell is left-aligned`);
    let wrongFont = 0;
    ws.eachRow((row) => row.eachCell((cell) => { if (cell.font?.name !== SE.FONT) wrongFont++; }));
    eq(wrongFont, 0, `${ws.name}: Nunito Sans throughout`);
  }

  const coc = wb.getWorksheet('Contract Over Contract');
  const head = coc.getRow(3).values.slice(1);
  const savingCol = head.indexOf('Saving') + 1;
  eq(typeof coc.getCell(4, savingCol).value, 'number', 'savings stay numbers');
  ok(String(coc.getCell(4, savingCol).numFmt).includes('[Red]'), 'with losses shown in red');
  ok(head.includes('Retail adder saving'), 'the adder split carries into the branded tab');
  const lastRow = coc.actualRowCount;
  eq(coc.getCell(lastRow, 1).value, 'Term total', 'the tab ends on the term total');
  eq(coc.getCell(lastRow, 1).fill?.fgColor?.argb, SE.GREEN_TINT, 'which is tinted green');
  eq(coc.getCell(lastRow, 1).font?.bold, true, 'and bold');

  const sum = wb.getWorksheet('Summary');
  const labels = [];
  sum.eachRow((row) => labels.push(row.getCell(1).value));
  ok(labels.includes('Saving over the term') && labels.includes('Assumptions'), 'the summary carries the savings and the assumptions');

  // Leave a copy for eyeballing when asked to (SAVINGS_XLSX_OUT=path).
  if (process.env.SAVINGS_XLSX_OUT) writeFileSync(process.env.SAVINGS_XLSX_OUT, Buffer.from(await wb.xlsx.writeBuffer()));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
