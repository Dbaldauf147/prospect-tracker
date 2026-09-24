// Assertion tests for the savings-by-category workbook: Step by step's last
// step, a tab per category, month by month.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/savingsCategoriesExport.test.mjs
//
// Pinned: a tab per category with the months of the term; each tab's months
// sum to the total the page shows for that category; every figure is a
// number, not a string; the adder split adds back up to the saving.
import {
  categoryFormulas, summaryInputs, summaryFormulas,
  categoryRuns, categoryMonthAoa, categoryHeaders, categoryFormats, summaryRows, summaryAoa,
  categoriesFilename, CATEGORY_SHEET, BASELINE_LABEL, buildSavingsCategoriesWorkbook, SE,
  chartsLayout, indexLeadIn, savingsCategoriesBuffer, CHARTS_SHEET, INDEX_CHART_LOOKBACK, INDEX_KIND_COLOR,
} from '../src/utils/savingsCategoriesExport.js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
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
  const figures = ['Volume (Dth)', 'Index ($/Dth)', 'Contract 2 all-in ($/Dth)', `${BASELINE_LABEL[key]} ($/Dth)`, `${BASELINE_LABEL[key]} cost`, 'Contract 2 cost', 'Saving', 'Running saving'].map(col);
  ok(figures.every(c => c >= 0) && months.every(r => figures.every(c => typeof r[c] === 'number')), `${key}: every figure is a number`);
  ok(head.includes(`${BASELINE_LABEL[key]} cost`), `${key}: the baseline is named for what it is`);
  months.forEach((r, i) => {
    if (i === 0) near(r[col(`${BASELINE_LABEL[key]} cost`)] - r[col('Contract 2 cost')], r[col('Saving')], 1e-6, `${key}: saving is baseline less contract`);
  });
}

{
  const coc = categoryMonthAoa('contract', runs.contract);
  const ch = coc[0];
  ok(coc[1].every((v, i) => i < 2 || i === 3 || ch[i] === 'Contract 1 adder ($/Dth)' || typeof v === 'number'), 'contract over contract rows are numbers');
  near(coc[1][6], 3.51, 1e-12, 'contract over contract is measured against Contract 1 every month');
  eq(ch.slice(7, 9), ['Contract 2 adder ($/Dth)', 'Contract 1 adder ($/Dth)'], 'both adders sit beside the all-ins');
  ok(coc.slice(1).every(r => r[7] === scenario.adder && r[8] === 'not given'), 'an unknown Contract 1 adder says so on every row');
  eq(categoryHeaders('index', scenario).includes('Contract 2 adder ($/Dth)'), false, 'the adder columns are only on the contract tab');
  eq(categoryHeaders('contract', scenario).includes('Retail adder saving'), false, 'no adder split without Contract 1\'s adder');

  const withAdder = categoryRuns({ ...scenario, currentAdder: 0.1 }, series, curve);
  const aoa = categoryMonthAoa('contract', withAdder.contract);
  const h = aoa[0];
  ok(h.includes('Retail adder saving') && h.includes('Commodity and basis saving'), 'with it, the adder split gets two columns');
  const last = aoa[aoa.length - 1];
  ok(aoa.slice(1).every(r => r[h.indexOf('Contract 1 adder ($/Dth)')] === 0.1), 'a known Contract 1 adder fills its column');
  eq(h.length, categoryFormats('contract', { ...scenario, currentAdder: 0.1 }).length, 'a format for every column with the split');
  near(last[h.indexOf('Retail adder saving')], (-0.276 - 0.1) * withAdder.contract.totals.volume, 1e-6, 'the adder saving is (adder 2 - adder 1) x volume, since both come off the index');
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

// ── Formulas: the workbook works its figures out rather than pasting them ──
{
  const withAdder = categoryRuns({ ...scenario, currentType: 'index', currentAdder: 0.1 }, series, curve);
  const inp = summaryInputs(withAdder);
  ok(/^'Summary'!\$B\$\d+$/.test(inp.basis) && /^'Summary'!\$B\$\d+$/.test(inp.adder), 'the inputs are the Summary\'s assumption cells');
  const f = categoryFormulas('contract', withAdder.contract, inp);
  const h = categoryHeaders('contract', withAdder.contract.scenario);
  eq(f.length, 13, 'a formula row per month and the total');
  eq(f[0][h.indexOf('Contract 2 all-in ($/Dth)')], `E4+${inp.basis}-${inp.adder}`, 'Contract 2 on the index is index + basis - adder');
  eq(f[0][h.indexOf('Contract 1 ($/Dth)')], `E4+${inp.basis}-N(${inp.c1Adder})`, 'Contract 1 on the index is index + basis - its adder');
  eq(f[0][h.indexOf('Index ($/Dth)')], null, 'the index itself is data, not a formula');
  eq(f[12][h.indexOf('Saving')], 'SUM(L4:L15)', 'the total sums the months');
  const fixed = categoryRuns({ ...scenario, contractType: 'fixed', fixedRate: 3.9, currentType: 'fixed' }, series, curve);
  const fi = summaryInputs(fixed);
  const ff = categoryFormulas('contract', fixed.contract, fi);
  eq(ff[0][h.indexOf('Contract 2 all-in ($/Dth)')], fi.fixed, 'a fixed Contract 2 reads its all-in off the Summary');
  eq(ff[0][h.indexOf('Contract 1 ($/Dth)')], fi.c1Rate, 'and so does a fixed Contract 1');
  const sf = summaryFormulas(withAdder);
  eq(sf['Saving over the term'][1], "'Contract Over Contract'!$L$16", 'the Summary\'s saving reads the tab total');
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
  eq(typeof coc.getCell(4, savingCol).value.result, 'number', 'savings are formulas with the number cached');
  eq(coc.getCell(4, savingCol).value.formula, 'J4-K4', 'the saving is baseline cost less contract cost');
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

// ── The Charts tab: native Excel charts over tables on the sheet ──
{
  const runs = categoryRuns(scenario, series, curve);
  const leadIn = indexLeadIn(scenario, series, curve);
  eq(leadIn.length, INDEX_CHART_LOOKBACK, 'the index chart leads in with a year before the term');
  eq(leadIn.every(m => m.phase === 'history'), true, 'all of it before the term');
  const term = runs.index.months;
  const all = [...leadIn, ...term];
  const { tables, charts } = chartsLayout(runs, leadIn);
  const [cons, allIn, idx] = tables;

  eq(charts.map(c => c.type), ['bar', 'line', 'line'], 'a column chart and two line charts');
  // Consumption: each month's volume in exactly one of the two columns.
  eq(cons.rows.map(r => r[1] ?? r[2]), term.map(m => m.volume), 'consumption plots the term volumes');
  eq(cons.rows.every(r => (r[1] == null) !== (r[2] == null)), true, 'entered or shaped, never both');
  eq(charts[1].series.map(x => x.name), ['Contract 2 all-in', 'Index all-in', 'Contract 1 all-in'], 'all-in: Contract 2, the index, Contract 1');
  eq(charts[1].series[0].values, term.map(m => m.contractAllIn), 'Contract 2 all-in per month');
  eq(charts[1].series[2].values, term.map(m => m.contract1AllIn), 'Contract 1 all-in per month');
  eq(idx.rows.map(r => r[2]), all.map(m => m.index), 'the index table runs through the lead-in and the term');
  eq(idx.rows[0][1], 'Before the term', 'lead-in rows are named as such');

  // The index split into a line per kind: every month in its own kind's
  // series, plus the hand-over month so the line does not break.
  const kinds = charts[2].series.map(x => x.name);
  ok(kinds.includes('Settled (past)') && kinds.includes('Forecast (forward curve)'), 'settled and forecast lines both drawn');
  const settled = charts[2].series.find(x => x.name === 'Settled (past)');
  const fcast = charts[2].series.find(x => x.name === 'Forecast (forward curve)');
  eq(settled.dash, 'solid', 'settled is solid');
  eq(fcast.dash, 'dash', 'forecast is dashed');
  all.forEach((m, i) => {
    if (m.source === 'settled' && settled.values[i] !== m.index) eq(settled.values[i], m.index, `settled ${m.label} plotted`);
    if (m.source === 'forward' && fcast.values[i] !== m.index) eq(fcast.values[i], m.index, `forecast ${m.label} plotted`);
  });
  const handOver = all.findIndex((m, i) => m.source === 'settled' && all[i + 1]?.source === 'forward');
  if (handOver >= 0) eq(fcast.values[handOver], all[handOver].index, 'the forecast line starts from the last settle');
  eq(fcast.values.filter(v => v != null).length <= all.filter(m => m.source === 'forward').length + 2, true, 'and otherwise stays off settled months');
  eq(charts[2].series[0].ref, `'Charts'!$${String.fromCharCode(64 + idx.col + 4)}$4:$${String.fromCharCode(64 + idx.col + 4)}$${3 + all.length}`, 'each series reads its own column');

  const wb = buildSavingsCategoriesWorkbook(ExcelJS.Workbook, runs, { charts: true, leadIn });
  eq(wb.worksheets.map(w => w.name), ['Summary', CHARTS_SHEET, 'Against the index', 'Contract Over Contract', 'Cost Avoidance'], 'Charts right after the Summary');
  const chs = wb.getWorksheet(CHARTS_SHEET);
  eq(chs.getCell(4, idx.col + 2).value, all[0].index, 'the index table is in cells');
  eq(chs.getColumn(idx.col + 4).hidden, true, 'the per-kind helper columns are hidden');
  eq(chs.getColumn(idx.col + 2).hidden, false, 'the index itself is not');

  // Forecast index months look different from settled ones, in the table
  // on the Charts tab and in the Index column of every category tab.
  const firstFwd = all.findIndex(m => m.source === 'forward');
  const firstSettled = all.findIndex(m => m.source === 'settled');
  eq(chs.getCell(4 + firstFwd, idx.col + 2).font?.italic, true, 'a forecast index is italic');
  eq(chs.getCell(4 + firstFwd, idx.col + 2).font?.color?.argb, INDEX_KIND_COLOR.forward, 'and blue');
  ok(!chs.getCell(4 + firstSettled, idx.col + 2).font?.italic, 'a settled index is not');
  const tab = wb.getWorksheet('Against the index');
  const tFwd = term.findIndex(m => m.source === 'forward');
  eq(tab.getCell(4 + tFwd, 5).font?.color?.argb, INDEX_KIND_COLOR.forward, 'the Index column marks forecast months');
  eq(tab.getCell(4 + tFwd, 5).font?.name, SE.FONT, 'without losing the house font');

  // The file itself: three chart parts, a drawing on the Charts sheet, and
  // the content types and relationships that make Excel load them.
  const buf = await savingsCategoriesBuffer(ExcelJS.Workbook, JSZip, runs, { leadIn });
  const zip = await JSZip.loadAsync(buf);
  const partNames = Object.keys(zip.files);
  eq(partNames.filter(n => /^xl\/charts\/chart\d+\.xml$/.test(n)).length, 3, 'three native chart parts');
  eq(partNames.some(n => n.startsWith('xl/media/')), false, 'and no pictures');
  const types = await zip.file('[Content_Types].xml').async('string');
  eq((types.match(/drawingml\.chart\+xml/g) || []).length, 3, 'each chart registered as a chart');
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const rid = wbXml.match(/<sheet\b[^>]*name="Charts"[^>]*>/)[0].match(/r:id="([^"]+)"/)[1];
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheetTarget = wbRels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    || wbRels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))[1];
  const sheetXml = await zip.file(`xl/${sheetTarget}`).async('string');
  ok(/<drawing r:id="[^"]+"\/>/.test(sheetXml), 'the Charts sheet carries the drawing');
  ok(sheetXml.indexOf('<drawing') > sheetXml.indexOf('<pageMargins'), 'after its page margins, where Excel wants it');
  const chart3 = await zip.file('xl/charts/chart3.xml').async('string');
  ok(chart3.includes('<a:prstDash val="dash"/>') && chart3.includes('<c:plotVisOnly val="0"/>'), 'the index chart dashes the forecast and plots hidden columns');
  ok(chart3.includes(`<c:f>${charts[2].series[0].ref}</c:f>`), 'and reads its range off the sheet');
  // Round trip: ExcelJS reads the file back without complaint.
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  eq(back.worksheets.length, 5, 'the finished file still opens');
  if (process.env.SAVINGS_XLSX_OUT) writeFileSync(process.env.SAVINGS_XLSX_OUT, Buffer.from(buf));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
