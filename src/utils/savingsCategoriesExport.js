// Step by step's last step as a workbook: the saving under every category
// (Against the index, Contract Over Contract, Cost Avoidance), a tab each,
// month by month over the term, with a Summary tab on the front that puts
// the three side by side with the assumptions that produced them.
//
// Same rules as savingsExport.js: every figure leaves as a number with a
// format on it, not as the string on screen, so the columns sum; and the
// assumptions travel with the numbers.
//
// Laid out in the Schneider Electric house style the app's other branded
// exports use (the Opportunity and Services Explored workbooks): a Life Is
// On green title band, a muted subtitle, dark green header rows, Nunito
// Sans, thin grey borders, zebra rows, a green tab and no gridlines.
//
// Term only, no look-back - the same months step 5 shows. The one exception
// is the index chart on the Charts tab, which leads in with a year of settled
// months so the forecast has something to be read against.
//
// Pure except for the download at the bottom, so the shape of the file is
// pinned by scripts/savingsCategoriesExport.test.mjs.

import {
  SAVINGS_BASES, CONTRACT_TYPES, VOLUME_SHAPES, buildSavings, sourceSummary,
} from './nymexSavings.js';
import { sanitizeExcelWorkbook, stripDashes } from './exportSanitize.js';

const PRICE_FMT = '"$"#,##0.000';
const MONEY_FMT = '"$"#,##0';
const VOL_FMT = '#,##0';
const PCT_FMT = '0.0%';
const UNIT = '$/Dth';

const SOURCE_LABEL = { settled: 'Settled', forward: 'Forward curve', assumed: 'Flat assumption' };
const VOLUME_SOURCE_LABEL = { entered: 'Entered', shape: 'Annual volume and shape' };

// What each category measures the contract against, as a column heading.
export const BASELINE_LABEL = {
  index: 'At index',
  contract: 'Contract 1',
  avoided: 'With no action',
};

// Excel caps a sheet name at 31 characters and bans a few; these are safe.
export const CATEGORY_SHEET = {
  index: 'Against the index',
  contract: 'Contract Over Contract',
  avoided: 'Cost Avoidance',
};

/** The term priced under every category, everything else as entered. */
export function categoryRuns(scenario, series, forward) {
  const out = {};
  for (const key of Object.keys(SAVINGS_BASES)) {
    out[key] = buildSavings({ ...scenario, savingsBasis: key, lookback: 0 }, series, forward);
  }
  return out;
}

// How many settled months the index chart shows ahead of the term.
export const INDEX_CHART_LOOKBACK = 12;

/**
 * The months the index chart leads in with: the year before the term opens,
 * priced the same way the term is. Kept apart from categoryRuns because no
 * category tab carries them; they are context for the chart only.
 */
export function indexLeadIn(scenario, series, forward, months = INDEX_CHART_LOOKBACK) {
  return buildSavings({ ...scenario, savingsBasis: 'index', lookback: months }, series, forward).history;
}

// What a month's index is, as the charts and the Index column tell it apart:
// a settle is the past, a forward quote is the forecast, and a flat
// assumption is neither and says so.
export const INDEX_KIND_LABEL = {
  settled: 'Settled (past)',
  forward: 'Forecast (forward curve)',
  assumed: 'Flat assumption',
};

/**
 * The three pictures on the Charts tab, as data: consumption per month,
 * the all-in prices per month, and the index per month with each point
 * marked settled or forecast. Pure, so what the charts plot is pinned by
 * the test; utils/savingsChartImage.js is what draws them.
 */
export function chartData(runs, leadIn = []) {
  const idx = runs?.index || runs?.[Object.keys(SAVINGS_BASES).find(k => runs?.[k])];
  const months = idx?.months || [];
  const s = idx?.scenario || {};
  const contract1 = runs?.contract?.months;
  const allInSeries = [
    { key: 'contract2', name: 'Contract 2 all-in', values: months.map(m => m.contractAllIn) },
    { key: 'index', name: 'Index all-in', values: months.map(m => m.indexAllIn) },
  ];
  if (contract1?.length === months.length && Number.isFinite(s.currentRate)) {
    allInSeries.push({ key: 'contract1', name: 'Contract 1 all-in', values: contract1.map(m => m.baselineAllIn) });
  }
  const indexMonths = [...leadIn, ...months];
  return {
    consumption: {
      title: 'Consumption by month',
      unit: 'Dth',
      labels: months.map(m => m.short || m.label),
      bars: months.map(m => ({ value: m.volume, kind: m.volumeSource === 'entered' ? 'entered' : 'shape' })),
    },
    allIn: {
      title: `All-in price by month (${UNIT})`,
      unit: UNIT,
      labels: months.map(m => m.short || m.label),
      series: allInSeries,
    },
    index: {
      title: `Index price by month, settled and forecast (${UNIT})`,
      unit: UNIT,
      labels: indexMonths.map(m => m.short || m.label),
      points: indexMonths.map(m => ({ value: m.index, kind: m.source })),
      termStart: leadIn.length,
    },
  };
}

/** The index chart's months as a table: month, index, what it is. */
export function indexTableAoa(runs, leadIn = []) {
  const idx = runs?.index || runs?.[Object.keys(SAVINGS_BASES).find(k => runs?.[k])];
  const rows = [...leadIn, ...(idx?.months || [])].map(m => [
    m.label,
    m.phase === 'history' ? 'Before the term' : 'Term',
    m.index,
    INDEX_KIND_LABEL[m.source] || m.source,
  ]);
  return [['Month', 'Period', `Index (${UNIT})`, 'Index is'], ...rows];
}

// Contract Over Contract only, and only once Contract 1's retail adder is
// known: the month's saving split into what the adder did and the rest.
const hasAdderSplit = (key, s) => key === 'contract' && s?.currentAdder != null && Number.isFinite(s.currentAdder);

/** Column headings for one category's tab. */
export function categoryHeaders(key, s) {
  const base = BASELINE_LABEL[key];
  return [
    'Month',
    'Priced from',
    'Volume (Dth)',
    'Volume from',
    `Index (${UNIT})`,
    `Contract 2 all-in (${UNIT})`,
    `${base} (${UNIT})`,
    `${base} cost`,
    'Contract 2 cost',
    'Saving',
    'Running saving',
    ...(hasAdderSplit(key, s) ? ['Retail adder saving', 'Commodity and basis saving'] : []),
  ];
}

/** One number format per column of a category tab, null for text. */
export function categoryFormats(key, s) {
  return [
    null, null, VOL_FMT, null, PRICE_FMT, PRICE_FMT, PRICE_FMT, MONEY_FMT, MONEY_FMT, MONEY_FMT, MONEY_FMT,
    ...(hasAdderSplit(key, s) ? [MONEY_FMT, MONEY_FMT] : []),
  ];
}

/**
 * One category's tab: a heading row, a row per month of the term, a total.
 * The total averages the three $/Dth columns (weighted by volume for the two
 * all-ins, as the page does) and sums the rest.
 */
export function categoryMonthAoa(key, run) {
  const s = run?.scenario || {};
  const split = hasAdderSplit(key, s);
  const adderPerDth = split ? s.currentAdder - s.adder : 0;
  const rows = (run?.months || []).map(m => [
    m.label,
    SOURCE_LABEL[m.source] || m.source,
    m.volume,
    VOLUME_SOURCE_LABEL[m.volumeSource] || VOLUME_SOURCE_LABEL.shape,
    m.index,
    m.contractAllIn,
    m.baselineAllIn,
    m.baselineCost,
    m.contractCost,
    m.saving,
    m.cumulative,
    ...(split ? [adderPerDth * m.volume, m.saving - adderPerDth * m.volume] : []),
  ]);
  const t = run?.totals || {};
  const total = [
    'Term total',
    sourceSummary(t),
    t.volume,
    '',
    t.avgIndex,
    t.avgContractAllIn,
    t.avgBaselineAllIn,
    t.baselineCost,
    t.contractCost,
    t.saving,
    t.saving,
    ...(split ? [adderPerDth * (t.volume || 0), (t.saving || 0) - adderPerDth * (t.volume || 0)] : []),
  ];
  return [categoryHeaders(key, s), ...rows, total];
}

/**
 * The Summary tab: the three categories side by side, then the assumptions.
 * Returned as rows of { label, values, fmt } so the formats can be stamped
 * onto the cells, and as an array of arrays by summaryAoa.
 */
export function summaryRows(runs) {
  const keys = Object.keys(SAVINGS_BASES).filter(k => runs?.[k]);
  const first = runs?.[keys[0]];
  const s = first?.scenario || {};
  const months = first?.months || [];
  const pick = (fn) => keys.map(k => fn(runs[k].totals || {}, k));
  const shape = VOLUME_SHAPES[s.volumeShape] || VOLUME_SHAPES.even;
  return [
    { label: 'Category', values: keys.map(k => SAVINGS_BASES[k].label) },
    { label: 'Measured against', values: keys.map(k => BASELINE_LABEL[k]) },
    { label: 'What it is', values: keys.map(k => SAVINGS_BASES[k].note) },
    { label: 'Saving over the term', values: pick(t => t.saving), fmt: MONEY_FMT },
    { label: `Saving per Dth (${UNIT})`, values: pick(t => t.savingPerDth), fmt: PRICE_FMT },
    { label: 'Saving as a share of the baseline', values: pick(t => t.savingPct), fmt: PCT_FMT },
    { label: 'Baseline cost', values: pick(t => t.baselineCost), fmt: MONEY_FMT },
    { label: 'Contract 2 cost', values: pick(t => t.contractCost), fmt: MONEY_FMT },
    { label: `Baseline all-in (${UNIT})`, values: pick(t => t.avgBaselineAllIn), fmt: PRICE_FMT },
    { label: `Contract 2 all-in (${UNIT})`, values: pick(t => t.avgContractAllIn), fmt: PRICE_FMT },
    { label: '', values: [] },
    { label: 'Assumptions', values: [] },
    { label: 'Site', values: [s.name || 'Not named'] },
    {
      label: 'Term',
      values: [months.length ? `${months[0].label} to ${months[months.length - 1].label} (${s.termMonths} months)` : 'no months'],
    },
    { label: 'Volume over the term (Dth)', values: [first?.totals?.volume], fmt: VOL_FMT },
    { label: 'Volume shape', values: [`${shape.label}, ${shape.note}`] },
    { label: 'Contract 2 type', values: [CONTRACT_TYPES[s.contractType]?.label || ''] },
    ...(s.contractType === 'fixed' ? [{ label: `Contract 2 fixed all-in (${UNIT})`, values: [s.fixedRate], fmt: PRICE_FMT }] : []),
    { label: `Contract 2 basis (${UNIT})`, values: [s.basis], fmt: PRICE_FMT },
    { label: `Contract 2 retail adder (${UNIT})`, values: [s.adder], fmt: PRICE_FMT },
    { label: `Contract 1 all-in rate (${UNIT})`, values: [s.currentRate], fmt: PRICE_FMT },
    {
      label: `Contract 1 retail adder (${UNIT})`,
      values: [s.currentAdder == null ? 'not given' : s.currentAdder],
      fmt: s.currentAdder == null ? null : PRICE_FMT,
    },
    { label: 'Increase with no action', values: [s.noActionPct / 100], fmt: PCT_FMT },
    { label: 'Increase on the strategy', values: [s.strategyPct / 100], fmt: PCT_FMT },
    { label: 'Priced from', values: [sourceSummary(first?.totals || {})] },
  ];
}

export function summaryAoa(runs) {
  return summaryRows(runs).map(r => [stripDashes(r.label), ...r.values.map(v => stripDashes(v))]);
}

export function categoriesFilename(name, date = new Date()) {
  const safe = String(name || 'site')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'site';
  const d = new Date(date);
  const stamp = isNaN(d) ? '' : `_${d.toISOString().slice(0, 10)}`;
  return `${safe}_savings_by_category${stamp}.xlsx`;
}

// Schneider Electric brand palette, as the other branded exports use it.
export const SE = {
  GREEN: 'FF3DCD58',       // Life Is On green: title band, tab
  GREEN_DARK: 'FF009530',  // header and section bands
  GREEN_TINT: 'FFE6F7EA',  // total rows
  SURFACE: 'FFF6F9F4',     // zebra rows, label column
  BORDER: 'FFD4DDE1',
  TEXT: 'FF1E293B',
  MUTED: 'FF64748B',
  WHITE: 'FFFFFFFF',
  FONT: 'Nunito Sans',
};

// Money and $/Dth with losses in red, so a category that costs money reads
// as one at a glance.
const MONEY_SIGNED = '"$"#,##0;[Red]-"$"#,##0';
const PRICE_SIGNED = '"$"#,##0.000;[Red]-"$"#,##0.000';
const signed = (fmt) => (fmt === MONEY_FMT ? MONEY_SIGNED : fmt === PRICE_FMT ? PRICE_SIGNED : fmt);

const thin = { style: 'thin', color: { argb: SE.BORDER } };
const BORDER_ALL = { top: thin, bottom: thin, left: thin, right: thin };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function addBrandedSheet(wb, name, span, subtitle) {
  const ws = wb.addWorksheet(name, {
    properties: { tabColor: { argb: SE.GREEN } },
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
  });
  ws.mergeCells(1, 1, 1, span);
  const title = ws.getCell(1, 1);
  title.value = 'Schneider Electric';
  title.font = { name: SE.FONT, bold: true, size: 18, color: { argb: SE.WHITE } };
  title.fill = fill(SE.GREEN);
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, span);
  const sub = ws.getCell(2, 1);
  sub.value = stripDashes(subtitle);
  sub.font = { name: SE.FONT, italic: true, size: 10, color: { argb: SE.MUTED } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;
  return ws;
}

function headerCell(cell, value) {
  cell.value = stripDashes(value);
  cell.font = { name: SE.FONT, bold: true, size: 10, color: { argb: SE.WHITE } };
  cell.fill = fill(SE.GREEN_DARK);
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
  cell.border = BORDER_ALL;
}

// Every cell, numbers included, is left-aligned: the house layout for these
// workbooks reads down a column from its left edge.
function bodyCell(cell, value, { fmt = null, zebra = false, bold = false, total = false, wrap = false } = {}) {
  cell.value = value === '' || value == null ? null : stripDashes(value);
  cell.font = { name: SE.FONT, size: 10, bold: bold || total, color: { argb: SE.TEXT } };
  if (fmt && typeof value === 'number') cell.numFmt = signed(fmt);
  if (total) cell.fill = fill(SE.GREEN_TINT);
  else if (zebra) cell.fill = fill(SE.SURFACE);
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: wrap, indent: 1 };
  cell.border = total ? { ...BORDER_ALL, top: { style: 'medium', color: { argb: SE.GREEN_DARK } } } : BORDER_ALL;
}

// The index charts' colours, carried onto the cells so a forecast month
// reads as one in the table the way it does on the chart: settled months
// keep the body style, forecast ones go blue italic, a flat assumption
// grey italic.
export const INDEX_KIND_COLOR = {
  settled: 'FF1E293B',
  forward: 'FF2563EB',
  assumed: 'FF64748B',
};

function markIndexKind(cell, kind) {
  if (!kind || kind === 'settled') return;
  cell.font = { ...cell.font, italic: true, color: { argb: INDEX_KIND_COLOR[kind] || INDEX_KIND_COLOR.assumed } };
}

/**
 * The whole workbook, Schneider Electric formatted, on an ExcelJS Workbook
 * class handed in (so it can be built and inspected in a test without a
 * browser). Summary first, then a tab per category.
 */
export function buildSavingsCategoriesWorkbook(Workbook, runs, { charts = null, leadIn = [] } = {}) {
  const wb = new Workbook();
  wb.creator = 'Schneider Electric · Prospect Tracker';
  wb.created = new Date();

  const keys = Object.keys(SAVINGS_BASES).filter(k => runs?.[k]);
  const first = runs?.[keys[0]];
  const site = first?.scenario?.name || 'Site';

  // ── Summary ──
  const rows = summaryRows(runs);
  const span = 1 + keys.length;
  const ws = addBrandedSheet(wb, 'Summary', span, `${site}  ·  Savings by category`);
  ws.columns = [{ width: 38 }, ...keys.map(() => ({ width: 34 }))];
  const [catRow, ...rest] = rows;
  headerCell(ws.getCell(3, 1), 'Savings');
  catRow.values.forEach((v, i) => headerCell(ws.getCell(3, i + 2), v));
  ws.getRow(3).height = 24;
  let r = 4;
  let zebra = false;
  for (const row of rest) {
    if (row.label === '') { r += 1; continue; }
    if (row.label === 'Assumptions') {
      ws.mergeCells(r, 1, r, span);
      headerCell(ws.getCell(r, 1), 'Assumptions');
      ws.getRow(r).height = 22;
      r += 1;
      zebra = false;
      continue;
    }
    const isHeadline = row.label === 'Saving over the term';
    bodyCell(ws.getCell(r, 1), row.label, { zebra: true, bold: true });
    if (row.values.length === 1 && keys.length > 1) {
      // An assumption: one value across the category columns.
      ws.mergeCells(r, 2, r, span);
      bodyCell(ws.getCell(r, 2), row.values[0], { fmt: row.fmt, zebra });
    } else {
      row.values.forEach((v, i) => bodyCell(ws.getCell(r, i + 2), v, {
        fmt: row.fmt, zebra, total: isHeadline, wrap: row.label === 'What it is',
      }));
    }
    if (row.label === 'What it is') ws.getRow(r).height = 44;
    else if (isHeadline) ws.getRow(r).height = 22;
    zebra = !zebra;
    r += 1;
  }

  // ── Charts ──
  // Pictures rather than native Excel charts, which ExcelJS cannot write.
  // The numbers behind them are all in the tabs, and the index months,
  // which reach back before the term, get a table of their own here.
  if (charts?.length) {
    const CHART_SPAN = 12;
    const chs = addBrandedSheet(wb, 'Charts', CHART_SPAN + 5, `${site}  ·  Consumption, all-in price and index over time`);
    chs.columns = [...Array(CHART_SPAN).fill({ width: 10 }), { width: 3 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 24 }];
    // Rows are the default 15pt, which is 20px.
    const ROW_PX = 20;
    let row = 4;
    for (const c of charts) {
      const id = wb.addImage({ base64: c.dataUrl, extension: 'png' });
      chs.addImage(id, { tl: { col: 0.2, row: row - 1 + 0.2 }, ext: { width: c.width, height: c.height } });
      row += Math.ceil(c.height / ROW_PX) + 2;
    }

    const [ih, ...ib] = indexTableAoa(runs, leadIn);
    const C0 = CHART_SPAN + 2;
    ih.forEach((h, i) => headerCell(chs.getCell(3, C0 + i), h));
    chs.getRow(3).height = 24;
    const kinds = [...leadIn, ...(runs?.index?.months || [])].map(m => m.source);
    ib.forEach((r, j) => {
      r.forEach((v, i) => bodyCell(chs.getCell(4 + j, C0 + i), v, { fmt: i === 2 ? PRICE_FMT : null, zebra: j % 2 === 1 }));
      markIndexKind(chs.getCell(4 + j, C0 + 2), kinds[j]);
      markIndexKind(chs.getCell(4 + j, C0 + 3), kinds[j]);
    });
  }

  // ── A tab per category ──
  for (const key of keys) {
    const run = runs[key];
    const aoa = categoryMonthAoa(key, run);
    const [head, ...body] = aoa;
    const formats = categoryFormats(key, run.scenario);
    const cws = addBrandedSheet(
      wb, CATEGORY_SHEET[key], head.length,
      `${site}  ·  ${SAVINGS_BASES[key].label}: ${SAVINGS_BASES[key].note}  ·  Forecast index months in blue italics`,
    );
    cws.columns = head.map((h, i) => ({ width: i === 0 ? 14 : i === 1 || i === 3 ? 22 : 16 }));
    head.forEach((h, i) => headerCell(cws.getCell(3, i + 1), h));
    cws.getRow(3).height = 32;
    body.forEach((row, j) => {
      const total = j === body.length - 1;
      row.forEach((v, i) => bodyCell(cws.getCell(4 + j, i + 1), v, {
        fmt: formats[i], zebra: j % 2 === 1, total,
      }));
      if (!total) {
        const kind = run.months[j]?.source;
        markIndexKind(cws.getCell(4 + j, 2), kind);
        markIndexKind(cws.getCell(4 + j, 5), kind);
      }
    });
    cws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: head.length } };
  }

  return sanitizeExcelWorkbook(wb);
}

/**
 * Build and download the workbook. Returns the number of months per tab.
 * `leadIn` is the settled year the index chart opens with (indexLeadIn).
 */
export async function downloadSavingsCategories(runs, { leadIn = [] } = {}, date = new Date()) {
  const [mod, { renderSavingsCharts }] = await Promise.all([import('exceljs'), import('./savingsChartImage.js')]);
  const Workbook = mod.Workbook || mod.default?.Workbook;
  const wb = buildSavingsCategoriesWorkbook(Workbook, runs, {
    charts: renderSavingsCharts(chartData(runs, leadIn)),
    leadIn,
  });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const any = runs?.[Object.keys(SAVINGS_BASES).find(k => runs?.[k])];
  const a = document.createElement('a');
  a.href = url;
  a.download = categoriesFilename(any?.scenario?.name, date);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return (any?.months || []).length;
}
