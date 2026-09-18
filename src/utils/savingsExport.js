// Take the Savings subtab's month by month table out as a workbook.
//
// The subtab already shows every month of the term, and the page it shows
// them on is where the numbers stop: the next thing that happens to them is
// somebody retyping thirty-six rows into a budget model, which is how a
// digit goes missing. So the months leave as a file.
//
// Two rules decide the shape of it.
//
// Every figure leaves as a NUMBER with a format on it rather than as the
// string on screen. "$3,906" in a cell is text that will not sum, and the
// one thing a reader will do with a column of savings is total it.
//
// The scenario travels with it on a second sheet. A column of savings with
// no strike, basis, adder or flat assumption beside it is not a claim
// anybody can check, and a file travels much further than the page it came
// off - so the flat-priced months are named as loudly here as they are on
// screen, where they carry their own flag in every table.
//
// Pure except for the download at the bottom: a run in, cells out, so the
// shape of the file is pinned by scripts/savingsExport.test.mjs rather than
// by clicking the button.

import { VOLUME_SHAPES, sourceSummary, volumeSummary } from './nymexSavings.js';
import { sanitizeSheetJsWorkbook, stripDashes } from './exportSanitize.js';

const PRICE_FMT = '"$"#,##0.000';
const MONEY_FMT = '"$"#,##0';
const VOL_FMT = '#,##0';
const PCT_FMT = '0.0%';

// The three places a month can be priced from, spelled out. The subtab flags
// these on the row; a spreadsheet has nowhere to hang a flag, so it gets a
// column of its own and the words in full.
const SOURCE_LABEL = {
  settled: 'Settled',
  forward: 'Forward curve',
  assumed: 'Flat assumption',
};

// Where a month's VOLUME came from, which is a separate question from where
// its price came from and earns its own column for the same reason the page
// gives it its own flag.
const VOLUME_SOURCE_LABEL = {
  entered: 'Entered',
  shape: 'Annual volume and shape',
};

const UNIT = '$/Dth';

export const SAVINGS_MONTH_HEADERS = [
  'Month',
  'Priced from',
  `Index (${UNIT})`,
  `Index all-in (${UNIT})`,
  `Contract all-in (${UNIT})`,
  'Volume (Dth)',
  'Volume from',
  'At index',
  'On contract',
  'Saving',
  'Running saving',
];

// One format per column of the month sheet, null where the column is text.
export const SAVINGS_MONTH_FORMATS = [
  null, null, PRICE_FMT, PRICE_FMT, PRICE_FMT, VOL_FMT, null, MONEY_FMT, MONEY_FMT, MONEY_FMT, MONEY_FMT,
];

/**
 * Header row, a row per month of the term, then the term total: the same
 * rows the Month by month table draws, in the same order.
 *
 * The total row averages the three price columns and sums the rest, which is
 * what the Year by year table's own total row does - a summed $/Dth would be
 * a number that means nothing.
 */
export function savingsMonthAoa(run) {
  const months = run?.months || [];
  const t = run?.totals || {};
  const rows = months.map(m => ([
    m.label,
    SOURCE_LABEL[m.source] || m.source,
    m.index,
    m.indexAllIn,
    m.contractAllIn,
    m.volume,
    VOLUME_SOURCE_LABEL[m.volumeSource] || m.volumeSource || VOLUME_SOURCE_LABEL.shape,
    m.indexCost,
    m.contractCost,
    m.saving,
    m.cumulative,
  ]));
  if (months.length) {
    rows.push([
      'Term total',
      sourceSummary(t),
      t.avgIndex,
      t.avgIndexAllIn,
      t.avgContractAllIn,
      t.volume,
      volumeSummary(t),
      t.indexCost,
      t.contractCost,
      t.saving,
      t.saving,
    ]);
  }
  return [SAVINGS_MONTH_HEADERS.map(stripDashes), ...rows];
}

/**
 * The assumptions behind those months, as label / value / number format.
 *
 * `meta` carries what the panel knows and the run does not: whether the two
 * tables underneath are the shipped ones or pasted, and the date the forward
 * curve was quoted at. A curve goes stale in a way a settle never does, so
 * the date it was quoted at has to leave with the file.
 */
export function savingsScenarioRows(run, meta = {}) {
  const s = run?.scenario || {};
  const t = run?.totals || {};
  const hedge = run?.hedge || {};
  const months = run?.months || [];
  const shape = VOLUME_SHAPES[s.volumeShape] || VOLUME_SHAPES.even;
  const layers = Array.isArray(s.layers) ? s.layers : [];
  return [
    { label: 'Scenario', value: s.name || 'Hedge savings' },
    {
      label: 'Term',
      value: months.length
        ? `${months[0].label} to ${months[months.length - 1].label}`
        : 'no months',
    },
    { label: 'Months', value: s.termMonths },
    { label: 'Annual volume (Dth)', value: s.annualVolumeDth, fmt: VOL_FMT },
    { label: 'Volume shape', value: `${shape.label}, ${shape.note}` },
    // Which months carry a volume somebody gave, and which were spread off
    // the annual number. A term that mixes the two makes two different
    // claims about volume, the way a term mixing settles and quotes makes
    // two about price.
    { label: 'Monthly volumes', value: volumeSummary(t) },
    { label: 'Volume over the term (Dth)', value: t.volume, fmt: VOL_FMT },
    { label: 'Hedged share', value: (hedge.pct ?? 0) / 100, fmt: PCT_FMT },
    {
      label: `Blended strike (${UNIT})`,
      value: hedge.price == null ? 'nothing locked' : hedge.price,
      fmt: hedge.price == null ? null : PRICE_FMT,
    },
    ...layers.map((l, i) => ({
      label: `Layer ${i + 1}: ${l.label}`,
      value: `${l.pct}% at $${Number(l.price).toFixed(3)}`,
    })),
    { label: `Basis (${UNIT})`, value: s.basis, fmt: PRICE_FMT },
    { label: `Retail adder (${UNIT})`, value: s.adder, fmt: PRICE_FMT },
    { label: `Flat assumption (${UNIT})`, value: s.forwardPrice, fmt: PRICE_FMT },
    { label: 'Priced from', value: sourceSummary(t) },
    { label: 'Settles table', value: meta.customSettles ? 'pasted' : 'shipped with the app' },
    {
      label: 'Forward curve',
      value: [meta.customForward ? 'pasted' : 'shipped with the app', meta.forwardAsOf]
        .filter(Boolean).join(', '),
    },
    { label: 'At index', value: t.indexCost, fmt: MONEY_FMT },
    { label: 'On contract', value: t.contractCost, fmt: MONEY_FMT },
    { label: 'Saving', value: t.saving, fmt: MONEY_FMT },
    { label: 'Saving against index', value: t.savingPct, fmt: PCT_FMT },
    { label: `Saving per Dth (${UNIT})`, value: t.savingPerDth, fmt: PRICE_FMT },
  ];
}

export function savingsScenarioAoa(run, meta = {}) {
  return [
    ['Assumption', 'Value'],
    ...savingsScenarioRows(run, meta).map(r => [stripDashes(r.label), stripDashes(r.value)]),
  ];
}

/**
 * A filename that survives every filesystem, stamped with the day it was
 * pulled so two exports a week apart do not overwrite each other. Same
 * shape the site list export uses.
 */
export function savingsFilename(name, date = new Date()) {
  const safe = String(name || 'hedge')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'hedge';
  const d = new Date(date);
  const stamp = isNaN(d) ? '' : `_${d.toISOString().slice(0, 10)}`;
  return `${safe}_savings_by_month${stamp}.xlsx`;
}

// Column widths, sized to the longest cell so the file opens readable rather
// than as a wall of ####. Capped, so one long note does not push the numbers
// off the screen.
export function columnWidths(aoa, { min = 10, max = 56 } = {}) {
  const [headers = [], ...rows] = aoa;
  return headers.map((h, i) => {
    let widest = String(h ?? '').length;
    for (const r of rows) {
      const len = String(r[i] ?? '').length;
      if (len > widest) widest = len;
    }
    return { wch: Math.max(min, Math.min(max, widest + 2)) };
  });
}

/**
 * Stamp a number format onto one column of a sheet, skipping the header and
 * any cell that did not come out as a number.
 *
 * SheetJS drops a format set on the column, so it goes on the cells.
 */
function formatColumn(XLSX, ws, col, fmt, rowCount) {
  if (!fmt) return;
  for (let r = 1; r <= rowCount; r++) {
    const cell = ws[XLSX.utils.encode_cell({ c: col, r })];
    if (cell && typeof cell.v === 'number') cell.z = fmt;
  }
}

/**
 * The one that touches the browser: the months on one sheet, the scenario on
 * the other, downloaded.
 *
 * The spreadsheet library is the heaviest thing this page could load and
 * only an export needs it, so it is pulled in on the click. Keeping that
 * import out here rather than in the panel also keeps it out of a component
 * body, where it blinds the react-hooks lint rules to everything around it.
 */
export async function downloadSavingsMonths(run, meta = {}, date = new Date()) {
  const monthAoa = savingsMonthAoa(run);
  const scenarioAoa = savingsScenarioAoa(run, meta);
  const XLSX = await import('xlsx');

  const monthSheet = XLSX.utils.aoa_to_sheet(monthAoa);
  SAVINGS_MONTH_FORMATS.forEach((fmt, c) => formatColumn(XLSX, monthSheet, c, fmt, monthAoa.length - 1));
  monthSheet['!cols'] = columnWidths(monthAoa, { min: 14, max: 28 });

  const scenarioSheet = XLSX.utils.aoa_to_sheet(scenarioAoa);
  savingsScenarioRows(run, meta).forEach((row, i) => {
    if (!row.fmt) return;
    const cell = scenarioSheet[XLSX.utils.encode_cell({ c: 1, r: i + 1 })];
    if (cell && typeof cell.v === 'number') cell.z = row.fmt;
  });
  scenarioSheet['!cols'] = columnWidths(scenarioAoa, { min: 16, max: 64 });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, monthSheet, 'Month by month');
  XLSX.utils.book_append_sheet(wb, scenarioSheet, 'Scenario');
  XLSX.writeFile(sanitizeSheetJsWorkbook(wb), savingsFilename(run?.scenario?.name, date));
  return (run?.months || []).length;
}
