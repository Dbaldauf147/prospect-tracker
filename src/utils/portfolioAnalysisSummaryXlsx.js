// Excel export of the portfolio-wide Master Analysis Summary popup, in the
// same Schneider Electric styling as the Master Analysis workbook itself:
// Nunito Sans, a dark green title band with the white logo, light green
// section bands, and dark green column headers.
//
// Three sheets, mirroring the popup:
//   Summary              savings by portfolio company, then compliance
//                        fines by portfolio company
//   Savings by Company   every company's markets, grouped under it
//   Compliance Summary   by portfolio company, then by jurisdiction
//
// Figures are written as numbers with a number format, never as
// pre-formatted text, so the sheet can be summed and sorted. The Low and
// High ends of a savings range get a column each for the same reason.

import { schneiderLogoPngDataUrl } from './schneiderLogo.js';

const SE_GREEN = 'FF3DCD58';
const SE_GREEN_DARK = 'FF009530';
const SE_GREEN_LIGHT = 'FFE6F7EC';
const SE_TEXT_DARK = 'FF1E293B';
const SE_BORDER = 'FFD4DDE1';
// Italic amber marks an estimated value, as on the Master Analysis's Site
// Detail sheet.
const SE_EST = 'FFB45309';
const FONT = 'Nunito Sans';
const MONEY = '"$"#,##0';
const INT = '#,##0';
const PCT = '0%';

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

// A sheet's title band (company name over the title, logo floated right).
// Returns the next free row.
function titleBand(wb, ws, span, title, firmName) {
  // Prints landscape, one page wide, however long the tables run.
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.mergeCells(1, 1, 1, span);
  const t = ws.getCell(1, 1);
  const titleFont = { name: FONT, bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  t.value = firmName
    ? { richText: [
      { font: { name: FONT, bold: true, size: 10, color: { argb: 'FFD1FADF' } }, text: `${firmName}\n` },
      { font: titleFont, text: title },
    ] }
    : title;
  if (!firmName) t.font = titleFont;
  t.fill = fill(SE_GREEN_DARK);
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(1).height = firmName ? 48 : 36;
  try {
    const logo = schneiderLogoPngDataUrl({ onDark: true, width: 190 });
    const id = wb.addImage({ base64: logo.dataUrl, extension: 'png' });
    ws.addImage(id, { tl: { col: Math.max(span - 4, 1), row: 0.16 }, ext: { width: logo.width, height: logo.height } });
  } catch { /* no canvas: the band reads fine without the logo */ }
  return 3;
}

// A light green section band across the table. Returns the next free row.
function sectionBand(ws, r, span, label) {
  ws.mergeCells(r, 1, r, span);
  const c = ws.getCell(r, 1);
  c.value = label;
  c.font = { name: FONT, bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
  c.fill = fill(SE_GREEN_LIGHT);
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 22;
  return r + 1;
}

// `cols`: [{ label, width, fmt }]. Returns the next free row. Every cell,
// figures included, is left-aligned.
function headerRow(ws, r, cols) {
  const row = ws.getRow(r);
  cols.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(SE_GREEN_DARK);
    cell.alignment = { vertical: 'bottom', horizontal: 'left', wrapText: true, indent: 1 };
    cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } }, right: { style: 'hair', color: { argb: 'FFFFFFFF' } } };
  });
  // Four lines of 10pt: the longest labels ("Energy Audits Est. Max
  // Fine / yr") wrap that far where the jurisdiction table puts them
  // under a narrower column.
  row.height = 58;
  return r + 1;
}

// One data row. `kind` is 'total' (bold, light green), 'group' (bold, a
// subtotal heading over the rows below it) or plain. `indent` pushes the
// first cell in under a group row. A value given as { v, est: true } is
// written italic amber: estimated.
function dataRow(ws, r, cols, values, { kind = '', indent = false } = {}) {
  const row = ws.getRow(r);
  cols.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    const raw = values[i];
    const est = !!(raw && typeof raw === 'object' && raw.est);
    const v = raw && typeof raw === 'object' && 'v' in raw ? raw.v : raw;
    cell.value = v === '' || v == null ? null : v;
    cell.font = { name: FONT, size: 10, bold: kind === 'total' || kind === 'group', italic: est, color: { argb: est ? SE_EST : SE_TEXT_DARK } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: i === 0 && indent ? 3 : 1, wrapText: !!c.wrap };
    if (c.fmt && typeof v === 'number') cell.numFmt = c.fmt;
    if (kind === 'total') {
      cell.fill = fill(SE_GREEN_LIGHT);
      cell.border = { top: { style: 'thin', color: { argb: SE_GREEN_DARK } }, bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
    } else {
      if (kind === 'group') cell.fill = fill('FFF8FAFC');
      cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } } };
    }
  });
  row.height = 18;
  return r + 1;
}

// Column widths sized to what is written in them, for a sheet whose
// columns hold more than one table. A figure is measured as its number
// format shows it; a header, which wraps, needs its longest word on one
// line and the whole label in no more than three. Widths are in Excel's
// character units, plus room for the cell's one-step indent.
class Fit {
  constructor(min = 10) { this.min = min; this.w = []; }
  bump(i, len) { this.w[i] = Math.max(this.w[i] || 0, len); }
  headers(cols) {
    cols.forEach((c, i) => {
      const words = String(c.label).split(/\s+/);
      this.bump(i, Math.max(...words.map(w => w.length), Math.ceil(String(c.label).length / 3)));
    });
  }
  values(cols, values) {
    cols.forEach((c, i) => {
      const v = values[i];
      if (v == null || v === '') return;
      let text = String(v);
      if (typeof v === 'number') {
        const whole = Math.round(v).toLocaleString('en-US');
        text = c.fmt === MONEY ? `$${whole}` : whole;
      }
      this.bump(i, text.length);
    });
  }
  widths(span) {
    return Array.from({ length: span }, (_, i) => Math.max(this.min, Math.ceil((this.w[i] || 0) * 1.1) + 3));
  }
}

// A blank number reads better than a zero in a column of site counts.
const n = (v) => (v ? v : null);

// Usage and spend: three figures, each followed by its estimated share.
const USAGE_COLS = [
  { label: 'Electric Usage (MWh/yr) †', fmt: INT, width: 14 },
  { label: 'Electric Usage % Est.', fmt: PCT, width: 10 },
  { label: 'Gas Usage (Dth/yr) †', fmt: INT, width: 14 },
  { label: 'Gas Usage % Est.', fmt: PCT, width: 10 },
  { label: 'Energy Spend/yr †', fmt: MONEY, width: 15 },
  { label: 'Spend % Est.', fmt: PCT, width: 10 },
];

// The six cells for a row's usage and spend. Electric usage is written in
// MWh; the workbook carries kWh.
function usageValues(r) {
  // "Unknown" only when none of the row's markets were found on Site
  // Detail; a row with some found shows the share of those.
  const unknown = r.estUnknown > 0 && !(r.estKnown > 0);
  const pair = (value, est) => {
    if (!value) return [null, null];
    const share = est > 0 ? est / value : 0;
    return [
      { v: Math.round(value), est: share > 0 },
      unknown ? { v: 'Unknown' } : { v: share, est: share > 0 },
    ];
  };
  return [
    ...pair((r.electricUsage || 0) / 1000, (r.electricUsageEst || 0) / 1000),
    ...pair(r.gasUsage || 0, r.gasUsageEst || 0),
    ...pair((r.electricCost || 0) + (r.gasCost || 0), (r.electricCostEst || 0) + (r.gasCostEst || 0)),
  ];
}

const USAGE_KEYS = ['electricUsage', 'electricUsageEst', 'gasUsage', 'gasUsageEst', 'electricCost', 'electricCostEst', 'gasCost', 'gasCostEst', 'estUnknown', 'estKnown'];

/**
 * Build the workbook (an ExcelJS Workbook).
 *
 *   firmName      the PE firm the popup was opened on
 *   savings       summariseMarkets() output
 *   compliance    { rows, byJurisdiction } as the popup builds them
 *   categories    [{ key, label }] in report order (BBS, Energy Audits, BPS)
 */
export async function buildPortfolioAnalysisSummary({
  firmName = '', savings, compliance, categories = [],
}) {
  // Named in the browser bundle, under `default` when Node loads it (tests).
  const mod = await import('exceljs');
  const Workbook = mod.Workbook || mod.default?.Workbook;
  const wb = new Workbook();

  // ---- Summary ----------------------------------------------------------
  {
    const ws = wb.addWorksheet('Summary', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }],
    });
    const companyCols = [
      { label: 'Portfolio Company', width: 30 },
      { label: 'Electric Deregulated Sites', fmt: INT, width: 14 },
      { label: 'Gas Deregulated Sites', fmt: INT, width: 14 },
      { label: 'Total Deregulated Sites', fmt: INT, width: 13 },
      ...USAGE_COLS,
      { label: 'Annual Savings Low', fmt: MONEY, width: 16 },
      { label: 'Annual Savings High', fmt: MONEY, width: 16 },
      { label: 'Indicative Year 1 Savings', fmt: MONEY, width: 16 },
      { label: 'Top Markets', width: 40, wrap: true },
    ];
    ws.columns = companyCols.map(c => ({ width: c.width }));
    const span = companyCols.length;
    let r = titleBand(wb, ws, span, 'Indicative Savings & Deregulated Sites', firmName);

    r = sectionBand(ws, r, span, 'By Portfolio Company');
    r = headerRow(ws, r, companyCols);
    const t = { e: 0, g: 0, low: 0, high: 0, ind: 0, ...Object.fromEntries(USAGE_KEYS.map(k => [k, 0])) };
    for (const c of savings.byCompany) {
      r = dataRow(ws, r, companyCols, [
        c.company,
        n(c.electricDeregulatedSites), n(c.gasDeregulatedSites), n(c.electricDeregulatedSites + c.gasDeregulatedSites),
        ...usageValues(c),
        n(c.low), n(c.high), c.indicative,
        c.markets.slice(0, 6).map(m => m.market).join(', '),
      ]);
      t.e += c.electricDeregulatedSites; t.g += c.gasDeregulatedSites;
      t.low += c.low; t.high += c.high; t.ind += c.indicative;
      for (const k of USAGE_KEYS) t[k] += c[k] || 0;
    }
    r = dataRow(ws, r, companyCols, [`Total (${savings.byCompany.length})`, t.e, t.g, t.e + t.g, ...usageValues(t), t.low, t.high, t.ind, ''], { kind: 'total' });
    r += 2;

    // Compliance fines by company, so the first tab reads as the whole
    // story. Shares the column widths above; the full breakdown (sites per
    // mandate, by jurisdiction) stays on the Compliance Summary tab.
    const fineCols = [
      { label: 'Portfolio Company' },
      { label: 'Sites Screened', fmt: INT },
      { label: 'Sites with a Mandate', fmt: INT },
      { label: 'Jurisdictions', fmt: INT },
      ...categories.map(k => ({ label: `${k.label} Est. Max Fine / yr`, fmt: MONEY })),
      { label: 'Est. Max Yearly Exposure', fmt: MONEY },
    ];
    r = sectionBand(ws, r, span, 'Compliance Fines by Portfolio Company');
    r = headerRow(ws, r, fineCols);
    const fineRows = compliance?.rows || [];
    const liveFines = fineRows.filter(c => !c.none);
    for (const c of fineRows) {
      if (c.none) {
        r = dataRow(ws, r, fineCols, [c.company, 'No site list to screen']);
        continue;
      }
      r = dataRow(ws, r, fineCols, [
        c.company, c.sitesScreened, n(c.sitesWithMandate), n(c.jurisdictions),
        ...categories.map(k => n(c.categories[k.key].penalty)),
        c.exposure,
      ]);
    }
    if (!fineRows.length) {
      dataRow(ws, r, fineCols, ['No compliance screening yet.']);
    } else {
      const fsum = (f) => liveFines.reduce((a, c) => a + (f(c) || 0), 0);
      dataRow(ws, r, fineCols, [
        `Total (${liveFines.length})`, fsum(c => c.sitesScreened), fsum(c => c.sitesWithMandate),
        new Set(liveFines.flatMap(c => c.jurisdictionIds || [])).size,
        ...categories.map(k => fsum(c => c.categories[k.key].penalty)),
        fsum(c => c.exposure),
      ], { kind: 'total' });
    }
  }

  // ---- Savings by Company ------------------------------------------------
  {
    const ws = wb.addWorksheet('Savings by Company', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }],
    });
    const cols = [
      { label: 'Portfolio Company / Market', width: 32 },
      { label: 'Country', width: 18 },
      { label: 'Electric Deregulated Sites', fmt: INT, width: 14 },
      { label: 'Gas Deregulated Sites', fmt: INT, width: 14 },
      ...USAGE_COLS,
      { label: 'Annual Savings Low', fmt: MONEY, width: 16 },
      { label: 'Annual Savings High', fmt: MONEY, width: 16 },
      { label: 'Indicative Year 1 Savings', fmt: MONEY, width: 16 },
    ];
    ws.columns = cols.map(c => ({ width: c.width }));
    let r = titleBand(wb, ws, cols.length, 'Deregulated Markets by Portfolio Company', firmName);
    r = sectionBand(ws, r, cols.length, 'By Portfolio Company and Market');
    r = headerRow(ws, r, cols);
    for (const c of savings.byCompany) {
      if (!c.markets.length) continue;
      r = dataRow(ws, r, cols, [c.company, '', n(c.electricDeregulatedSites), n(c.gasDeregulatedSites), ...usageValues(c), n(c.low), n(c.high), c.indicative], { kind: 'group' });
      for (const m of c.markets) {
        r = dataRow(ws, r, cols, [m.market, m.country, n(m.electricDeregulatedSites), n(m.gasDeregulatedSites), ...usageValues(m), n(m.low), n(m.high), m.indicative], { indent: true });
      }
    }
  }

  // ---- Compliance Summary ------------------------------------------------
  {
    const ws = wb.addWorksheet('Compliance Summary', {
      properties: { tabColor: { argb: SE_GREEN_DARK } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }],
    });
    const catCols = categories.flatMap(k => [
      { label: `${k.label} Sites`, fmt: INT },
      { label: `${k.label} Est. Max Fine / yr`, fmt: MONEY },
    ]);
    const companyCols = [
      { label: 'Portfolio Company' },
      { label: 'Sites Screened', fmt: INT },
      { label: 'Sites with a Mandate', fmt: INT },
      { label: 'Jurisdictions', fmt: INT },
      ...catCols,
      { label: 'Est. Max Yearly Exposure', fmt: MONEY },
    ];
    const jurCols = [
      { label: 'Jurisdiction' },
      { label: 'Sites with a Mandate', fmt: INT },
      { label: 'Portfolio Companies', fmt: INT },
      ...catCols,
      { label: 'Est. Max Yearly Exposure', fmt: MONEY },
      // One line, comma-separated: the column is sized to the longest list
      // below rather than wrapped into a tall row.
      { label: 'Portfolio Company Names' },
    ];
    // The two tables share the sheet's columns, so each column is sized to
    // whichever table needs it wider. `fit` collects that as rows are written.
    const fit = new Fit();
    fit.headers(companyCols);
    fit.headers(jurCols);
    const span = Math.max(companyCols.length, jurCols.length);
    let r = titleBand(wb, ws, span, 'Building Compliance Summary', firmName);
    r = sectionBand(ws, r, span, 'By Portfolio Company');
    r = headerRow(ws, r, companyCols);
    const live = (compliance?.rows || []).filter(c => !c.none);
    const companyRow = (values, opts) => { fit.values(companyCols, values); r = dataRow(ws, r, companyCols, values, opts); };
    for (const c of compliance?.rows || []) {
      if (c.none) {
        // Not measured: the note runs over the empty cells beside it.
        fit.values(companyCols, [c.company]);
        r = dataRow(ws, r, companyCols, [c.company, 'No site list to screen']);
        continue;
      }
      companyRow([
        c.company, c.sitesScreened, n(c.sitesWithMandate), n(c.jurisdictions),
        ...categories.flatMap(k => [n(c.categories[k.key].sites), n(c.categories[k.key].penalty)]),
        c.exposure,
      ]);
    }
    const sum = (f) => live.reduce((s, c) => s + (f(c) || 0), 0);
    companyRow([
      `Total (${live.length})`, sum(c => c.sitesScreened), sum(c => c.sitesWithMandate),
      new Set(live.flatMap(c => c.jurisdictionIds || [])).size,
      ...categories.flatMap(k => [sum(c => c.categories[k.key].sites), sum(c => c.categories[k.key].penalty)]),
      sum(c => c.exposure),
    ], { kind: 'total' });
    r += 2;

    r = sectionBand(ws, r, span, 'By Jurisdiction (all portfolio companies)');
    r = headerRow(ws, r, jurCols);
    for (const j of compliance?.byJurisdiction || []) {
      const values = [
        j.government, j.sites, j.companies.length,
        ...categories.flatMap(k => [n(j[k.key].sites), n(j[k.key].penalty)]),
        j.penalty, j.companies.join(', '),
      ];
      fit.values(jurCols, values);
      r = dataRow(ws, r, jurCols, values);
    }
    fit.widths(span).forEach((width, i) => { ws.getColumn(i + 1).width = width; });
    if (!(compliance?.byJurisdiction || []).length) dataRow(ws, r, jurCols, ['No site falls under a mandate.']);
  }
  return wb;
}

/** Build the workbook and hand it to the browser as a download. */
export async function downloadPortfolioAnalysisSummary(opts) {
  const wb = await buildPortfolioAnalysisSummary(opts);
  const today = new Date();
  const firmName = opts?.firmName || '';
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = String(firmName || 'Portfolio').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  a.download = `${safe} - Master Analysis Summary - ${today.toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
