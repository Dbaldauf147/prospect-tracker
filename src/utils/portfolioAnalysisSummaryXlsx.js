// Excel export of the portfolio-wide Master Analysis Summary popup, in the
// same Schneider Electric styling as the Master Analysis workbook itself:
// Nunito Sans, a dark green title band with the white logo, light green
// section bands, and dark green column headers.
//
// Three sheets, mirroring the popup:
//   Savings Summary      by portfolio company, then by country / state
//                        across the portfolio
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
const SE_SLATE = 'FF475569';
const SE_BORDER = 'FFD4DDE1';
// Italic amber marks an estimated value, as on the Master Analysis's Site
// Detail sheet.
const SE_EST = 'FFB45309';
const FONT = 'Nunito Sans';
const MONEY = '"$"#,##0';
const INT = '#,##0';
const PCT = '0%';

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

// A sheet's title band (company name over the title, logo floated right)
// and the italic subtitle under it. Returns the next free row.
function titleBand(wb, ws, span, title, firmName, subtitle) {
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

  ws.mergeCells(2, 1, 2, span);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, italic: true, size: 10, color: { argb: SE_SLATE } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;
  return 4;
}

// A light green section band across the table, with an optional note row
// under it. Returns the next free row.
function sectionBand(ws, r, span, label, note) {
  ws.mergeCells(r, 1, r, span);
  const c = ws.getCell(r, 1);
  c.value = label;
  c.font = { name: FONT, bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
  c.fill = fill(SE_GREEN_LIGHT);
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 22;
  r += 1;
  if (note) {
    ws.mergeCells(r, 1, r, span);
    const n = ws.getCell(r, 1);
    n.value = note;
    n.font = { name: FONT, italic: true, size: 9, color: { argb: SE_SLATE } };
    n.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
    // Tall enough for the note to wrap: roughly 1.2 characters of 9pt
    // italic per unit of column width, 13 points a line.
    const width = (ws.columns || []).slice(0, span).reduce((a, c) => a + (c.width || 10), 0);
    const lines = Math.ceil(String(note).length / Math.max(40, width * 1.2));
    ws.getRow(r).height = Math.max(18, lines * 13 + 4);
    r += 1;
  }
  return r;
}

// `cols`: [{ label, width, fmt, align }]. Returns the next free row.
function headerRow(ws, r, cols) {
  const row = ws.getRow(r);
  cols.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(SE_GREEN_DARK);
    cell.alignment = { vertical: 'bottom', horizontal: c.fmt ? 'right' : 'left', wrapText: true, indent: 1 };
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
    cell.alignment = { vertical: 'middle', horizontal: c.fmt ? 'right' : 'left', indent: i === 0 && indent ? 3 : 1, wrapText: !!c.wrap };
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

// A blank number reads better than a zero in a column of site counts.
const n = (v) => (v ? v : null);

const SAVINGS_NOTE = 'Savings Low / High: each deregulated market\'s spend at its Low and High %, once every supply agreement is open. '
  + 'Indicative Year 1: the analysis\'s own figure, counting only spend already out of contract. '
  + 'Markets priced TBD (no Low / High %) are not in the range. '
  + '† Usage and spend cover the deregulated sites. Italic amber values include estimated data: usage modeled from the property type where none was uploaded, '
  + 'spend priced at the indicative rate where no actual cost was uploaded. The % Est. column beside each is the estimated share; '
  + 'upright values are all from uploaded data. "Unknown" means the market\'s sites were not found on the analysis\'s Site Detail sheet; '
  + 'a total over some such markets shows the share of the rest.';

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
 *   savedAt       Map company -> ISO date its analysis was saved
 *   compliance    { rows, byJurisdiction } as the popup builds them
 *   categories    [{ key, label }] in report order (BBS, Energy Audits, BPS)
 *   analysed / totalCompanies   for the subtitle
 */
export async function buildPortfolioAnalysisSummary({
  firmName = '', savings, savedAt = new Map(), compliance, categories = [], analysed = 0, totalCompanies = 0,
}) {
  // Named in the browser bundle, under `default` when Node loads it (tests).
  const mod = await import('exceljs');
  const Workbook = mod.Workbook || mod.default?.Workbook;
  const wb = new Workbook();
  const today = new Date();
  const subtitle = `Master Analysis Summary  ·  ${analysed} of ${totalCompanies} portfolio companies analysed  ·  ${today.toLocaleDateString()}`;

  // ---- Savings Summary ---------------------------------------------------
  {
    const ws = wb.addWorksheet('Savings Summary', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
    });
    const companyCols = [
      { label: 'Portfolio Company', width: 30 },
      { label: 'Analysis Saved', width: 14 },
      { label: 'Electric Deregulated Sites', fmt: INT, width: 14 },
      { label: 'Gas Deregulated Sites', fmt: INT, width: 14 },
      { label: 'Deregulated Markets', fmt: INT, width: 13 },
      ...USAGE_COLS,
      { label: 'Annual Savings Low', fmt: MONEY, width: 16 },
      { label: 'Annual Savings High', fmt: MONEY, width: 16 },
      { label: 'Indicative Year 1 Savings', fmt: MONEY, width: 16 },
      { label: 'Top Markets', width: 40, wrap: true },
    ];
    ws.columns = companyCols.map(c => ({ width: c.width }));
    const span = companyCols.length;
    let r = titleBand(wb, ws, span, 'Indicative Savings & Deregulated Sites', firmName, subtitle);

    r = sectionBand(ws, r, span, 'By Portfolio Company', SAVINGS_NOTE);
    r = headerRow(ws, r, companyCols);
    const t = { e: 0, g: 0, low: 0, high: 0, ind: 0, ...Object.fromEntries(USAGE_KEYS.map(k => [k, 0])) };
    for (const c of savings.byCompany) {
      const d = savedAt.get(c.company) ? new Date(savedAt.get(c.company)) : null;
      r = dataRow(ws, r, companyCols, [
        c.company,
        d && !isNaN(d) ? d.toLocaleDateString() : '',
        n(c.electricDeregulatedSites), n(c.gasDeregulatedSites), c.markets.length,
        ...usageValues(c),
        n(c.low), n(c.high), c.indicative,
        c.markets.slice(0, 6).map(m => m.market).join(', '),
      ]);
      t.e += c.electricDeregulatedSites; t.g += c.gasDeregulatedSites;
      t.low += c.low; t.high += c.high; t.ind += c.indicative;
      for (const k of USAGE_KEYS) t[k] += c[k] || 0;
    }
    r = dataRow(ws, r, companyCols, [`Total (${savings.byCompany.length})`, '', t.e, t.g, savings.byMarket.length, ...usageValues(t), t.low, t.high, t.ind, ''], { kind: 'total' });
    r += 2;

    // Same widths as the table above, so the two read as one sheet.
    const marketCols = [
      { label: 'Country / ST / Prov' },
      { label: 'Country' },
      { label: 'Electric Deregulated Sites', fmt: INT },
      { label: 'Gas Deregulated Sites', fmt: INT },
      { label: 'Portfolio Companies', fmt: INT },
      ...USAGE_COLS.map(({ label, fmt }) => ({ label, fmt })),
      { label: 'Annual Savings Low', fmt: MONEY },
      { label: 'Annual Savings High', fmt: MONEY },
      { label: 'Indicative Year 1 Savings', fmt: MONEY },
      { label: 'Portfolio Company Names', wrap: true },
    ];
    r = sectionBand(ws, r, span, 'By Country / State (all portfolio companies)', 'A site in a dual-fuel market counts once under electric and once under gas. Italic amber values include estimated data (see the note above).');
    r = headerRow(ws, r, marketCols);
    for (const c of savings.byCountry) {
      r = dataRow(ws, r, marketCols, [
        c.country, c.country, n(c.electricDeregulatedSites), n(c.gasDeregulatedSites), c.companies.length,
        ...usageValues(c),
        n(c.low), n(c.high), c.indicative, c.companies.join(', '),
      ], { kind: 'group' });
      for (const m of savings.byMarket.filter(x => x.country === c.country && x.market !== c.country)) {
        r = dataRow(ws, r, marketCols, [
          m.market, m.country, n(m.electricDeregulatedSites), n(m.gasDeregulatedSites), m.companies.length,
          ...usageValues(m),
          n(m.low), n(m.high), m.indicative, m.companies.join(', '),
        ], { indent: true });
      }
    }
  }

  // ---- Savings by Company ------------------------------------------------
  {
    const ws = wb.addWorksheet('Savings by Company', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
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
    let r = titleBand(wb, ws, cols.length, 'Deregulated Markets by Portfolio Company', firmName, subtitle);
    r = sectionBand(ws, r, cols.length, 'By Portfolio Company and Market', SAVINGS_NOTE);
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
      views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
    });
    const catCols = categories.flatMap(k => [
      { label: `${k.label} Sites`, fmt: INT, width: 12 },
      { label: `${k.label} Est. Max Fine / yr`, fmt: MONEY, width: 15 },
    ]);
    const companyCols = [
      { label: 'Portfolio Company', width: 30 },
      { label: 'Sites Screened', fmt: INT, width: 12 },
      { label: 'Sites with a Mandate', fmt: INT, width: 12 },
      { label: 'Jurisdictions', fmt: INT, width: 15 },
      ...catCols,
      { label: 'Est. Max Yearly Exposure', fmt: MONEY, width: 16 },
      { label: 'Sites Screened From', width: 30, wrap: true },
    ];
    ws.columns = companyCols.map(c => ({ width: c.width }));
    const span = companyCols.length;
    let r = titleBand(wb, ws, span, 'Building Compliance Summary', firmName, subtitle);
    r = sectionBand(ws, r, span, 'By Portfolio Company',
      'Each company\'s sites screened against the benchmarking (BBS), energy audit and building performance (BPS) ordinances. Fines are the estimated max per year.');
    r = headerRow(ws, r, companyCols);
    const live = (compliance?.rows || []).filter(c => !c.none);
    for (const c of compliance?.rows || []) {
      if (c.none) {
        r = dataRow(ws, r, companyCols, [c.company, ...companyCols.slice(1, -1).map(() => null), 'No site list to screen']);
        continue;
      }
      r = dataRow(ws, r, companyCols, [
        c.company, c.sitesScreened, n(c.sitesWithMandate), n(c.jurisdictions),
        ...categories.flatMap(k => [n(c.categories[k.key].sites), n(c.categories[k.key].penalty)]),
        c.exposure,
        c.source === 'workbook' ? 'Master Analysis Site List tab' : 'Saved site list',
      ]);
    }
    const sum = (f) => live.reduce((s, c) => s + (f(c) || 0), 0);
    r = dataRow(ws, r, companyCols, [
      `Total (${live.length})`, sum(c => c.sitesScreened), sum(c => c.sitesWithMandate),
      new Set(live.flatMap(c => c.jurisdictionIds || [])).size,
      ...categories.flatMap(k => [sum(c => c.categories[k.key].sites), sum(c => c.categories[k.key].penalty)]),
      sum(c => c.exposure), '',
    ], { kind: 'total' });
    r += 2;

    const jurCols = [
      { label: 'Jurisdiction' },
      { label: 'Sites with a Mandate', fmt: INT },
      { label: 'Portfolio Companies', fmt: INT },
      ...catCols,
      { label: 'Est. Max Yearly Exposure', fmt: MONEY },
      { label: 'Portfolio Company Names', wrap: true },
    ];
    r = sectionBand(ws, r, span, 'By Jurisdiction (all portfolio companies)', 'A site that owes more than one mandate counts once.');
    r = headerRow(ws, r, jurCols);
    for (const j of compliance?.byJurisdiction || []) {
      r = dataRow(ws, r, jurCols, [
        j.government, j.sites, j.companies.length,
        ...categories.flatMap(k => [n(j[k.key].sites), n(j[k.key].penalty)]),
        j.penalty, j.companies.join(', '),
      ]);
    }
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
