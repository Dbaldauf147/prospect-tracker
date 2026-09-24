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
  SAVINGS_BASES, CONTRACT_TYPES, CURRENT_CONTRACT_TYPES, VOLUME_SHAPES, buildSavings, sourceSummary,
} from './nymexSavings.js';
import { sanitizeExcelWorkbook, stripDashes } from './exportSanitize.js';
import { addNativeCharts, colRef } from './xlsxNativeCharts.js';

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

// The Charts tab: the charts down the left, the tables they plot from on
// the right. Native Excel charts (utils/xlsxNativeCharts.js) point at those
// cells, so the numbers under every point are there to read, and a chart
// can be restyled or re-ranged in Excel like any other.
export const CHARTS_SHEET = 'Charts';
const CHART_COLS = 12;      // columns A:L hold the charts
const CHART_ROWS = 19;      // each chart is this many rows tall
const TABLE_ROW = 3;        // table headings sit on the header row

// Colours: checked with the dataviz palette validator on a light surface.
const C_GREEN = '009530';
const C_GREEN_LIGHT = '7FCA97';
const C_BLUE = '2563EB';
const C_ORANGE = 'C2410C';
const C_INK = '1E293B';
const C_GREY = '64748B';

const INDEX_LINE = {
  settled: { color: C_INK, dash: 'solid' },
  forward: { color: C_BLUE, dash: 'dash' },
  assumed: { color: C_GREY, dash: 'dot' },
};

/**
 * Everything on the Charts tab, as data: three tables (placed by column)
 * and three chart specs whose ranges point into them. Pure, so the test
 * pins both what is plotted and where it is read from.
 *
 * The index table carries a hidden column per kind of month (settled,
 * forecast, flat assumption), each holding only its own months, so the chart
 * can draw a line per kind in its own style. A month is also written into
 * the next kind's column when that kind starts on the month after it, so
 * the line runs on unbroken where one kind hands over to the next.
 */
export function chartsLayout(runs, leadIn = []) {
  const idx = runs?.index || runs?.[Object.keys(SAVINGS_BASES).find(k => runs?.[k])];
  const months = idx?.months || [];
  const labels = months.map(m => m.label);
  const hasC1 = months.length > 0 && months.every(m => Number.isFinite(m.contract1AllIn));

  const consumption = {
    col: CHART_COLS + 1,
    head: ['Month', 'Entered (Dth)', 'Annual volume and shape (Dth)'],
    fmts: [null, VOL_FMT, VOL_FMT],
    widths: [12, 14, 18],
    rows: months.map(m => [
      m.label,
      m.volumeSource === 'entered' ? m.volume : null,
      m.volumeSource === 'entered' ? null : m.volume,
    ]),
  };
  const allIn = {
    col: consumption.col + consumption.head.length + 1,
    head: ['Month', `Contract 2 all-in (${UNIT})`, `Index all-in (${UNIT})`, ...(hasC1 ? [`Contract 1 all-in (${UNIT})`] : [])],
    fmts: [null, PRICE_FMT, PRICE_FMT, PRICE_FMT],
    widths: [12, 16, 16, 16],
    rows: months.map(m => [m.label, m.contractAllIn, m.indexAllIn, ...(hasC1 ? [m.contract1AllIn] : [])]),
  };

  const all = [...leadIn, ...months];
  const kinds = all.map(m => m.source);
  const KINDS = ['settled', 'forward', 'assumed'];
  const present = KINDS.filter(k => kinds.includes(k));
  const index = {
    col: allIn.col + allIn.head.length + 1,
    head: ['Month', 'Period', `Index (${UNIT})`, 'Index is', ...present.map(k => INDEX_KIND_LABEL[k])],
    fmts: [null, null, PRICE_FMT, null, ...present.map(() => PRICE_FMT)],
    widths: [12, 16, 12, 24, ...present.map(() => 12)],
    hiddenFrom: 4,
    kinds,
    rows: all.map((m, i) => [
      m.label,
      m.phase === 'history' ? 'Before the term' : 'Term',
      m.index,
      INDEX_KIND_LABEL[m.source] || m.source,
      ...present.map(k => (kinds[i] === k || kinds[i + 1] === k ? m.index : null)),
    ]),
  };

  const first = TABLE_ROW + 1;
  const ref = (t, c) => colRef(CHARTS_SHEET, t.col - 1 + c, first, first + t.rows.length - 1);
  const pick = (t, c) => t.rows.map(r => r[c]);
  const at = (n) => ({ from: { col: 0, row: TABLE_ROW - 1 + n * (CHART_ROWS + 1) }, to: { col: CHART_COLS, row: TABLE_ROW - 1 + n * (CHART_ROWS + 1) + CHART_ROWS } });
  const termStart = months[0]?.label;

  const charts = [
    {
      type: 'bar',
      title: 'Consumption by month (Dth)',
      anchor: at(0),
      yFormat: '#,##0',
      categories: { ref: ref(consumption, 0), values: labels },
      series: [
        { name: 'Entered', ref: ref(consumption, 1), values: pick(consumption, 1), color: C_GREEN },
        { name: 'Annual volume and shape', ref: ref(consumption, 2), values: pick(consumption, 2), color: C_GREEN_LIGHT },
      ],
    },
    {
      type: 'line',
      title: `All-in price by month (${UNIT})`,
      anchor: at(1),
      yFormat: '"$"#,##0.00',
      categories: { ref: ref(allIn, 0), values: labels },
      series: [
        // Wider and underneath, so where it runs on the index (an unhedged
        // index deal) it shows as a green edge rather than vanishing.
        { name: 'Contract 2 all-in', ref: ref(allIn, 1), values: pick(allIn, 1), color: C_GREEN, width: 4.5 },
        { name: 'Index all-in', ref: ref(allIn, 2), values: pick(allIn, 2), color: C_BLUE },
        ...(hasC1 ? [{ name: 'Contract 1 all-in', ref: ref(allIn, 3), values: pick(allIn, 3), color: C_ORANGE }] : []),
      ],
    },
    {
      type: 'line',
      title: `Index price, settled and forecast (${UNIT})${leadIn.length && termStart ? `. Term starts ${termStart}` : ''}`,
      anchor: at(2),
      yFormat: '"$"#,##0.00',
      categories: { ref: ref(index, 0), values: all.map(m => m.label) },
      series: present.map((k, j) => ({
        name: INDEX_KIND_LABEL[k],
        ref: ref(index, 4 + j),
        values: pick(index, 4 + j),
        ...INDEX_LINE[k],
      })),
    },
  ];
  return { tables: [consumption, allIn, index], charts };
}

// Contract Over Contract only, and only once Contract 1's retail adder is
// known: the month's saving split into what the adder did and the rest.
const hasAdderSplit = (key, s) => key === 'contract' && s?.currentAdder != null && Number.isFinite(s.currentAdder);

// Contract Over Contract also shows each contract's retail adder beside the
// all-ins, so the adder saving can be read straight off the row. Contract 1's
// is 'not given' until somebody types it, as on the Summary.
const hasAdderColumns = (key) => key === 'contract';
const adderCells = (key, s) => (hasAdderColumns(key)
  ? [s.adder, hasAdderSplit(key, s) ? s.currentAdder : 'not given']
  : []);

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
    ...(hasAdderColumns(key) ? [`Contract 2 adder (${UNIT})`, `Contract 1 adder (${UNIT})`] : []),
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
    null, null, VOL_FMT, null, PRICE_FMT, PRICE_FMT, PRICE_FMT,
    ...(hasAdderColumns(key) ? [PRICE_FMT, hasAdderSplit(key, s) ? PRICE_FMT : null] : []),
    MONEY_FMT, MONEY_FMT, MONEY_FMT, MONEY_FMT,
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
  const adderPerDth = split ? s.adder - s.currentAdder : 0;
  const rows = (run?.months || []).map(m => [
    m.label,
    SOURCE_LABEL[m.source] || m.source,
    m.volume,
    VOLUME_SOURCE_LABEL[m.volumeSource] || VOLUME_SOURCE_LABEL.shape,
    m.index,
    m.contractAllIn,
    m.baselineAllIn,
    ...adderCells(key, s),
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
    ...adderCells(key, s),
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
    { label: 'Contract 1 priced as', values: [(CURRENT_CONTRACT_TYPES[s.currentType] || CURRENT_CONTRACT_TYPES.fixed).label] },
    // A fixed Contract 1 has a rate; an index one has only the average its
    // months came to (index + basis + its adder).
    s.currentType === 'index'
      ? { label: `Contract 1 all-in, average (${UNIT})`, values: [first?.totals?.avgContract1AllIn], fmt: PRICE_FMT }
      : { label: `Contract 1 all-in rate (${UNIT})`, values: [s.currentRate], fmt: PRICE_FMT },
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
export function buildSavingsCategoriesWorkbook(Workbook, runs, { charts = false, leadIn = [] } = {}) {
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
  // The tables the charts plot from. The charts themselves are added once
  // the file is written (savingsCategoriesBuffer), since ExcelJS cannot.
  if (charts) {
    const { tables } = chartsLayout(runs, leadIn);
    const last = tables[tables.length - 1];
    const span = last.col + last.head.length - 1;
    const chs = addBrandedSheet(wb, CHARTS_SHEET, span, `${site}  ·  Consumption, all-in price and index over time. Forecast index months in blue italics`);
    const widths = Array(span).fill(10);
    for (const t of tables) t.widths.forEach((w, i) => { widths[t.col - 1 + i] = w; });
    chs.columns = widths.map(width => ({ width }));
    for (const t of tables) {
      t.head.forEach((h, i) => headerCell(chs.getCell(TABLE_ROW, t.col + i), h));
      t.rows.forEach((r, j) => {
        r.forEach((v, i) => bodyCell(chs.getCell(TABLE_ROW + 1 + j, t.col + i), v, { fmt: t.fmts[i], zebra: j % 2 === 1 }));
        if (t.kinds) {
          markIndexKind(chs.getCell(TABLE_ROW + 1 + j, t.col + 2), t.kinds[j]);
          markIndexKind(chs.getCell(TABLE_ROW + 1 + j, t.col + 3), t.kinds[j]);
        }
      });
      // The per-kind helper columns only exist for the chart to read.
      if (t.hiddenFrom != null) {
        for (let i = t.hiddenFrom; i < t.head.length; i++) chs.getColumn(t.col + i).hidden = true;
      }
    }
    chs.getRow(TABLE_ROW).height = 32;
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
 * The finished file as bytes: the workbook ExcelJS writes, with the native
 * charts added to its Charts tab. The two libraries are handed in so a test
 * can build it without a browser.
 */
export async function savingsCategoriesBuffer(Workbook, JSZip, runs, { leadIn = [] } = {}) {
  const wb = buildSavingsCategoriesWorkbook(Workbook, runs, { charts: true, leadIn });
  const buf = await wb.xlsx.writeBuffer();
  return addNativeCharts(JSZip, buf, CHARTS_SHEET, chartsLayout(runs, leadIn).charts);
}

/**
 * Build and download the workbook. Returns the number of months per tab.
 * `leadIn` is the settled year the index chart opens with (indexLeadIn).
 */
export async function downloadSavingsCategories(runs, { leadIn = [] } = {}, date = new Date()) {
  const [mod, zipMod] = await Promise.all([import('exceljs'), import('jszip')]);
  const Workbook = mod.Workbook || mod.default?.Workbook;
  const buf = await savingsCategoriesBuffer(Workbook, zipMod.default || zipMod, runs, { leadIn });
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
