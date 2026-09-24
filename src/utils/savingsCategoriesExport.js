// Step by step's last step as a workbook: the saving under every category
// (Against the index, Contract Over Contract, Cost Avoidance), a tab each,
// month by month over the term, with a Summary tab on the front that puts
// the three side by side with the assumptions that produced them.
//
// Same rules as savingsExport.js: every figure leaves as a number with a
// format on it, not as the string on screen, so the columns sum; and the
// assumptions travel with the numbers.
//
// Term only, no look-back - the same months step 5 shows.
//
// Pure except for the download at the bottom, so the shape of the file is
// pinned by scripts/savingsCategoriesExport.test.mjs.

import {
  SAVINGS_BASES, CONTRACT_TYPES, VOLUME_SHAPES, buildSavings, sourceSummary,
} from './nymexSavings.js';
import { sanitizeSheetJsWorkbook, stripDashes } from './exportSanitize.js';
import { columnWidths } from './savingsExport.js';

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

function stampFormats(XLSX, ws, formats, rowCount) {
  formats.forEach((fmt, c) => {
    if (!fmt) return;
    for (let r = 1; r <= rowCount; r++) {
      const cell = ws[XLSX.utils.encode_cell({ c, r })];
      if (cell && typeof cell.v === 'number') cell.z = fmt;
    }
  });
}

/** Build and download the workbook. Returns the number of months per tab. */
export async function downloadSavingsCategories(runs, date = new Date()) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const rows = summaryRows(runs);
  const sAoa = summaryAoa(runs);
  const summary = XLSX.utils.aoa_to_sheet(sAoa);
  rows.forEach((row, r) => {
    if (!row.fmt) return;
    row.values.forEach((_, i) => {
      const cell = summary[XLSX.utils.encode_cell({ c: i + 1, r })];
      if (cell && typeof cell.v === 'number') cell.z = row.fmt;
    });
  });
  summary['!cols'] = [{ wch: 34 }, { wch: 28 }, { wch: 28 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, summary, 'Summary');

  for (const key of Object.keys(SAVINGS_BASES)) {
    const run = runs?.[key];
    if (!run) continue;
    const aoa = categoryMonthAoa(key, run).map(r => r.map(v => stripDashes(v)));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    stampFormats(XLSX, ws, categoryFormats(key, run.scenario), aoa.length - 1);
    ws['!cols'] = columnWidths(aoa, { min: 12, max: 26 });
    XLSX.utils.book_append_sheet(wb, ws, CATEGORY_SHEET[key]);
  }

  const any = runs?.[Object.keys(SAVINGS_BASES).find(k => runs?.[k])];
  XLSX.writeFile(sanitizeSheetJsWorkbook(wb), categoriesFilename(any?.scenario?.name, date));
  return (any?.months || []).length;
}
