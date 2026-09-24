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
import { addNativeCharts, colRef, colName } from './xlsxNativeCharts.js';

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
// The commodity and basis part is the saving less the adder part. When the
// adder is the whole saving the two cancel to float dust (-0.0000001), which
// the signed money format shows as a red -$0; rounding to the cent gives a
// true zero. Math.round(-0.4) is -0, so the + 0 folds that into 0 as well.
const cents = (v) => Math.round(v * 100) / 100 + 0;

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
    ...(split ? [adderPerDth * m.volume, cents(m.saving - adderPerDth * m.volume)] : []),
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
    ...(split ? [adderPerDth * (t.volume || 0), cents((t.saving || 0) - adderPerDth * (t.volume || 0))] : []),
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
    // What the layers lock, as the two numbers the contract's all-in is
    // worked out from on every tab.
    ...(s.contractType === 'layered' ? [
      { label: 'Contract 2 hedged share', values: [(first?.hedge?.pct ?? 0) / 100], fmt: PCT_FMT },
      { label: `Contract 2 hedge price (${UNIT})`, values: [first?.hedge?.price ?? 0], fmt: PRICE_FMT },
    ] : []),
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

/**
 * The sheet row each Summary label lands on, laid out the way the workbook
 * writes it: the category header on row 3, then a row per label with a
 * blank label skipping one.
 */
export function summaryRowNumbers(rows) {
  const at = {};
  let r = 4;
  for (const row of rows.slice(1)) {
    if (row.label !== '') at[row.label] = r;
    r += 1;
  }
  return at;
}

// ── Formulas ──
// Every figure the workbook derives is written as the Excel formula that
// derives it, with the number the page came to cached as its result. Each
// category tab is self-contained: it carries the assumptions it prices from
// in its own block beside the month table, and its month rows read only
// cells on that tab, so a tab can be read (or copied out) on its own and
// every formula points somewhere on the same page. Only what has to cross
// pages does: the Summary's headline rows read each tab's totals, and the
// Charts tables read the tabs. What is data rather than arithmetic (the
// index, the volumes, the labels) stays a plain value.

const sheetRef = (sheet) => `'${String(sheet).replace(/'/g, "''")}'`;
const abs = (sheet, col, row) => `${sheetRef(sheet)}!$${col}$${row}`;

// The assumptions a tab can carry, in the order its block lists them, keyed
// to the Summary label each takes its value from.
const INPUT_LABELS = {
  fixed: `Contract 2 fixed all-in (${UNIT})`,
  share: 'Contract 2 hedged share',
  strike: `Contract 2 hedge price (${UNIT})`,
  basis: `Contract 2 basis (${UNIT})`,
  adder: `Contract 2 retail adder (${UNIT})`,
  c1Rate: `Contract 1 all-in rate (${UNIT})`,
  c1Adder: `Contract 1 retail adder (${UNIT})`,
  noAction: 'Increase with no action',
  strategy: 'Increase on the strategy',
};

// Which of them one category's formulas read.
function neededInputs(key, s) {
  const need = new Set(
    s.contractType === 'fixed' ? ['fixed']
      : s.contractType === 'layered' ? ['share', 'strike', 'basis', 'adder']
        : ['basis', 'adder'],
  );
  if (key === 'index') { need.add('basis'); need.add('adder'); }
  if (key === 'avoided') { need.add('noAction'); need.add('strategy'); }
  if (key === 'contract') {
    if (s.currentType === 'index') { need.add('basis'); need.add('c1Adder'); } else need.add('c1Rate');
    // The two adder columns.
    need.add('adder'); need.add('c1Adder');
  }
  return Object.keys(INPUT_LABELS).filter(k => need.has(k));
}

// Where a tab's assumptions block sits: one blank column after the month
// table, a label column and a value column, headed on the table's header row.
export const TAB_INPUT_GAP = 1;
export function tabInputsLayout(key, run) {
  const head = categoryHeaders(key, run?.scenario || {});
  const labelCol = head.length + 1 + TAB_INPUT_GAP;
  return { labelCol, valueCol: labelCol + 1, headRow: 3, firstRow: 4 };
}

/**
 * One category tab's own assumptions: the rows its block lists (label,
 * value and format, the same as the Summary shows them) and an absolute
 * same-tab reference to each value cell, null for one it doesn't use.
 */
export function tabInputs(key, runs) {
  const run = runs?.[key];
  const s = run?.scenario || {};
  const byLabel = Object.fromEntries(summaryRows(runs).map(r => [r.label, r]));
  const { valueCol, firstRow } = tabInputsLayout(key, run);
  const col = colName(valueCol - 1);
  const rows = [];
  const refs = Object.fromEntries(Object.keys(INPUT_LABELS).map(k => [k, null]));
  for (const id of neededInputs(key, s)) {
    const src = byLabel[INPUT_LABELS[id]];
    if (!src) continue;
    refs[id] = `$${col}$${firstRow + rows.length}`;
    rows.push({ id, label: src.label, value: src.values[0], fmt: src.fmt });
  }
  return { rows, refs };
}

/**
 * One category tab's formulas, the same shape as categoryMonthAoa without
 * its heading row: a formula string (no leading =) or null for a value.
 */
export function categoryFormulas(key, run, inp) {
  const s = run?.scenario || {};
  const head = categoryHeaders(key, s);
  const base = BASELINE_LABEL[key];
  const L = (h) => colName(head.indexOf(h));
  const C = L('Volume (Dth)'), E = L(`Index (${UNIT})`), F = L(`Contract 2 all-in (${UNIT})`), G = L(`${base} (${UNIT})`);
  const H = L(`Contract 2 adder (${UNIT})`), I = L(`Contract 1 adder (${UNIT})`);
  const BC = L(`${base} cost`), CC = L('Contract 2 cost'), SV = L('Saving'), RS = L('Running saving');
  const AS = L('Retail adder saving'), RE = L('Commodity and basis saving');
  const n = (run?.months || []).length;
  const first = 4;
  const T = first + n;
  const range = (c) => `${c}${first}:${c}${T - 1}`;

  const contract2 = (r) => {
    if (s.contractType === 'fixed') return inp.fixed;
    const tail = `+${inp.basis}-${inp.adder}`;
    if (s.contractType === 'layered') return `${inp.share}*${inp.strike}+(1-${inp.share})*${E}${r}${tail}`;
    return `${E}${r}${tail}`;
  };
  const baseline = (r) => {
    if (key === 'index') return `${E}${r}+${inp.basis}-${inp.adder}`;
    if (key === 'avoided') return `${F}${r}*(1+${inp.noAction}-${inp.strategy})`;
    // N() reads a Contract 1 adder that is 'not given' as the $0 the page takes it as.
    return s.currentType === 'index' ? `${E}${r}+${inp.basis}-N(${inp.c1Adder})` : inp.c1Rate;
  };

  const row = (cells) => head.map((h, i) => cells[colName(i)] ?? null);
  const rows = [];
  for (let j = 0; j < n; j++) {
    const r = first + j;
    rows.push(row({
      [F]: contract2(r),
      [G]: baseline(r),
      ...(head.includes(`Contract 2 adder (${UNIT})`) ? { [H]: inp.adder, [I]: inp.c1Adder } : {}),
      [BC]: `${C}${r}*${G}${r}`,
      [CC]: `${C}${r}*${F}${r}`,
      [SV]: `${BC}${r}-${CC}${r}`,
      [RS]: j === 0 ? `${SV}${r}` : `${RS}${r - 1}+${SV}${r}`,
      ...(head.includes('Retail adder saving') ? { [AS]: `(${H}${r}-${I}${r})*${C}${r}`, [RE]: `ROUND(${SV}${r}-${AS}${r},2)` } : {}),
    }));
  }
  const perDth = (c) => `IF(${C}${T}=0,0,${c}${T}/${C}${T})`;
  rows.push(row({
    [C]: `SUM(${range(C)})`,
    [E]: n ? `AVERAGE(${range(E)})` : null,
    [F]: perDth(CC),
    [G]: perDth(BC),
    ...(head.includes(`Contract 2 adder (${UNIT})`) ? { [H]: inp.adder, [I]: inp.c1Adder } : {}),
    [BC]: `SUM(${range(BC)})`,
    [CC]: `SUM(${range(CC)})`,
    [SV]: `SUM(${range(SV)})`,
    [RS]: n ? `${RS}${T - 1}` : `${SV}${T}`,
    ...(head.includes('Retail adder saving') ? { [AS]: `SUM(${range(AS)})`, [RE]: `SUM(${range(RE)})` } : {}),
  }));
  return rows;
}

/** A category tab's totals row and the columns on it, for the Summary and Charts to read. */
function tabCells(key, run) {
  const head = categoryHeaders(key, run?.scenario || {});
  const base = BASELINE_LABEL[key];
  const sheet = CATEGORY_SHEET[key];
  const L = (h) => colName(head.indexOf(h));
  return {
    total: 4 + (run?.months || []).length,
    cell: (h, row) => abs(sheet, L(h), row),
    col: {
      volume: 'Volume (Dth)', index: `Index (${UNIT})`, contract: `Contract 2 all-in (${UNIT})`,
      baseline: `${base} (${UNIT})`, baselineCost: `${base} cost`, contractCost: 'Contract 2 cost', saving: 'Saving',
    },
  };
}

/** The Summary's formulas by label: one per value, null for a plain value. */
export function summaryFormulas(runs) {
  const keys = Object.keys(SAVINGS_BASES).filter(k => runs?.[k]);
  const tab = Object.fromEntries(keys.map(k => [k, tabCells(k, runs[k])]));
  const each = (fn) => keys.map(k => {
    const t = tab[k];
    const at = (c) => t.cell(t.col[c], t.total);
    return fn(at);
  });
  const out = {
    'Saving over the term': each(at => at('saving')),
    [`Saving per Dth (${UNIT})`]: each(at => `IF(${at('volume')}=0,0,${at('saving')}/${at('volume')})`),
    'Saving as a share of the baseline': each(at => `IF(${at('baselineCost')}=0,0,${at('saving')}/${at('baselineCost')})`),
    'Baseline cost': each(at => at('baselineCost')),
    'Contract 2 cost': each(at => at('contractCost')),
    [`Baseline all-in (${UNIT})`]: each(at => at('baseline')),
    [`Contract 2 all-in (${UNIT})`]: each(at => at('contract')),
  };
  const any = tab.index || tab[keys[0]];
  if (any) out['Volume over the term (Dth)'] = [any.cell(any.col.volume, any.total)];
  if (tab.contract) out[`Contract 1 all-in, average (${UNIT})`] = [tab.contract.cell(tab.contract.col.baseline, tab.contract.total)];
  return out;
}

/**
 * The Charts tables' formulas, table by table in the shape of their rows:
 * the term's months read the category tabs; the lead-in months, which no
 * tab carries, stay values.
 */
export function chartsFormulas(runs, layout) {
  const idxKey = runs?.index ? 'index' : Object.keys(SAVINGS_BASES).find(k => runs?.[k]);
  if (!idxKey) return layout.tables.map(t => t.rows.map(r => r.map(() => null)));
  const it = tabCells(idxKey, runs[idxKey]);
  const ct = runs.contract ? tabCells('contract', runs.contract) : null;
  const [consumption, allIn, index] = layout.tables;
  const monthRow = (j) => 4 + j;
  const lead = index.rows.length - (runs[idxKey].months || []).length;
  return [
    consumption.rows.map((r, j) => [null, r[1] != null ? it.cell(it.col.volume, monthRow(j)) : null, r[2] != null ? it.cell(it.col.volume, monthRow(j)) : null]),
    allIn.rows.map((r, j) => [
      null,
      it.cell(it.col.contract, monthRow(j)),
      idxKey === 'index' ? it.cell(it.col.baseline, monthRow(j)) : null,
      ...(r.length > 3 ? [ct ? ct.cell(ct.col.baseline, monthRow(j)) : null] : []),
    ]),
    index.rows.map((r, j) => {
      const sheetRow = TABLE_ROW + 1 + j;
      const own = `${colName(index.col - 1 + 2)}${sheetRow}`;
      return r.map((v, i) => {
        if (i === 2) return j >= lead ? it.cell(it.col.index, monthRow(j - lead)) : null;
        if (i >= 4 && v != null) return own;
        return null;
      });
    }),
  ];
}

// A cell value with its formula, the number kept as the cached result so
// the file reads right before Excel recalculates.
const withFormula = (value, formula) => (formula
  ? { formula, ...(value === '' || value == null ? {} : { result: value }) }
  : value);

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
  const isFormula = value != null && typeof value === 'object' && 'formula' in value;
  cell.value = value === '' || value == null ? null : isFormula ? value : stripDashes(value);
  cell.font = { name: SE.FONT, size: 10, bold: bold || total, color: { argb: SE.TEXT } };
  if (fmt && (typeof value === 'number' || isFormula)) cell.numFmt = signed(fmt);
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
  // The cells are formulas with the page's numbers cached on them; have
  // Excel work them out afresh when the file opens.
  wb.calcProperties.fullCalcOnLoad = true;

  const keys = Object.keys(SAVINGS_BASES).filter(k => runs?.[k]);
  const first = runs?.[keys[0]];
  const site = first?.scenario?.name || 'Site';

  // ── Summary ──
  const rows = summaryRows(runs);
  const span = 1 + keys.length;
  const ws = addBrandedSheet(wb, 'Summary', span, `${site}  ·  Savings by category`);
  ws.columns = [{ width: 38 }, ...keys.map(() => ({ width: 34 }))];
  const [catRow, ...rest] = rows;
  const sumF = summaryFormulas(runs);
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
      bodyCell(ws.getCell(r, 2), withFormula(row.values[0], sumF[row.label]?.[0]), { fmt: row.fmt, zebra });
    } else {
      row.values.forEach((v, i) => bodyCell(ws.getCell(r, i + 2), withFormula(v, sumF[row.label]?.[i]), {
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
    const layout = chartsLayout(runs, leadIn);
    const { tables } = layout;
    const chartF = chartsFormulas(runs, layout);
    const last = tables[tables.length - 1];
    const span = last.col + last.head.length - 1;
    const chs = addBrandedSheet(wb, CHARTS_SHEET, span, `${site}  ·  Consumption, all-in price and index over time. Forecast index months in blue italics`);
    const widths = Array(span).fill(10);
    for (const t of tables) t.widths.forEach((w, i) => { widths[t.col - 1 + i] = w; });
    chs.columns = widths.map(width => ({ width }));
    tables.forEach((t, ti) => {
      t.head.forEach((h, i) => headerCell(chs.getCell(TABLE_ROW, t.col + i), h));
      t.rows.forEach((r, j) => {
        r.forEach((v, i) => bodyCell(chs.getCell(TABLE_ROW + 1 + j, t.col + i), withFormula(v, chartF[ti]?.[j]?.[i]), { fmt: t.fmts[i], zebra: j % 2 === 1 }));
        if (t.kinds) {
          markIndexKind(chs.getCell(TABLE_ROW + 1 + j, t.col + 2), t.kinds[j]);
          markIndexKind(chs.getCell(TABLE_ROW + 1 + j, t.col + 3), t.kinds[j]);
        }
      });
      // The per-kind helper columns only exist for the chart to read.
      if (t.hiddenFrom != null) {
        for (let i = t.hiddenFrom; i < t.head.length; i++) chs.getColumn(t.col + i).hidden = true;
      }
    });
    chs.getRow(TABLE_ROW).height = 32;
  }

  // ── A tab per category ──
  for (const key of keys) {
    const run = runs[key];
    const aoa = categoryMonthAoa(key, run);
    const inputs = tabInputs(key, runs);
    const box = tabInputsLayout(key, run);
    const formulas = categoryFormulas(key, run, inputs.refs);
    const [head, ...body] = aoa;
    const formats = categoryFormats(key, run.scenario);
    const cws = addBrandedSheet(
      wb, CATEGORY_SHEET[key], inputs.rows.length ? box.valueCol : head.length,
      `${site}  ·  ${SAVINGS_BASES[key].label}: ${SAVINGS_BASES[key].note}  ·  Forecast index months in blue italics`,
    );
    cws.columns = [
      ...head.map((h, i) => ({ width: i === 0 ? 14 : i === 1 || i === 3 ? 22 : 16 })),
      ...(inputs.rows.length ? [...Array(TAB_INPUT_GAP).fill({ width: 3 }), { width: 34 }, { width: 16 }] : []),
    ];
    head.forEach((h, i) => headerCell(cws.getCell(3, i + 1), h));
    cws.getRow(3).height = 32;
    body.forEach((row, j) => {
      const total = j === body.length - 1;
      row.forEach((v, i) => bodyCell(cws.getCell(4 + j, i + 1), withFormula(v, formulas[j]?.[i]), {
        fmt: formats[i], zebra: j % 2 === 1, total,
      }));
      if (!total) {
        const kind = run.months[j]?.source;
        markIndexKind(cws.getCell(4 + j, 2), kind);
        markIndexKind(cws.getCell(4 + j, 5), kind);
      }
    });
    // The assumptions this tab's formulas read, beside the table.
    if (inputs.rows.length) {
      headerCell(cws.getCell(box.headRow, box.labelCol), 'Assumptions');
      headerCell(cws.getCell(box.headRow, box.valueCol), 'Value');
      inputs.rows.forEach((row, j) => {
        bodyCell(cws.getCell(box.firstRow + j, box.labelCol), row.label, { zebra: true, bold: true });
        bodyCell(cws.getCell(box.firstRow + j, box.valueCol), row.value, { fmt: row.fmt, zebra: j % 2 === 1 });
      });
    }
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
