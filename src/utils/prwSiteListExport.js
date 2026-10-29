// A company's saved Site List in the PRW Site List layout.
//
// PRW takes sites in one fixed twelve-column shape - where the site is,
// then spend / usage / accounts for electric and for gas - so this is not
// the pick-your-columns export beside it: the columns are PRW's, and each
// is filled from whichever of the list's own columns holds that figure.
//
// The list is a mix of what the uploaded file said and what the Utility
// Lookup analysis modeled, and a reader of the file has to be able to tell
// the two apart. A Utility Lookup save records, per row, which columns it
// estimated (ESTIMATED_COLUMN); a cell taken from one of those is marked
// estimated. Accounts are never written per commodity by the save, so
// unless the list carries its own account columns they come from the
// site's property type and are always estimates.
//
// Pure except for the download helper at the bottom, so the shape of the
// file is pinned by scripts/prwSiteListExport.test.mjs.

import { ESTIMATED_COLUMN } from './siteListMerge.js';
import { pickSiteNameColumn, pickZipColumn } from './siteColumns.js';
import { accountsForTenure } from './ownershipEstimates.js';
import { stripDashes, sanitizeExcelWorkbook } from './exportSanitize.js';
import { siteRegionOf, NORTH_AMERICA, EUROPE, REST_OF_WORLD } from './siteRegion.js';
import { repairSiteLocation } from './siteAddressRepair.js';

// The columns, in PRW's order. `kind` picks the number format.
export const PRW_COLUMNS = [
  { key: 'siteName', label: 'Site Name', width: 30 },
  { key: 'address', label: 'Address', width: 36 },
  { key: 'city', label: 'City', width: 20 },
  { key: 'state', label: 'State', width: 12 },
  { key: 'zip', label: 'Zip Code', width: 12 },
  { key: 'country', label: 'Country', width: 14 },
  { key: 'electricSpend', label: 'Electric Power Spend', width: 20, kind: 'money' },
  { key: 'electricUsage', label: 'Electric Power Usage', width: 20, kind: 'kwh' },
  { key: 'electricAccounts', label: 'Electric Power Accounts', width: 22, kind: 'count' },
  { key: 'gasSpend', label: 'Natural Gas Spend', width: 20, kind: 'money' },
  { key: 'gasUsage', label: 'Natural Gas Usage', width: 18, kind: 'dth' },
  { key: 'gasAccounts', label: 'Natural Gas Accounts', width: 20, kind: 'count' },
];

export const PRW_NUM_FMT = {
  money: '"$"#,##0',
  kwh: '#,##0 "kWh"',
  dth: '#,##0 "Dth"',
  count: '#,##0.##;-#,##0.##;0',
};

// An analysis column as the save wrote it: its own label, or the label
// pushed to "(analysis)" / "(analysis 2)" around a colliding upload column.
const analysisName = (label) => {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${esc}( \\(analysis( \\d+)?\\))?$`, 'i');
};

// Every header matching the first pattern that matches anything, then the
// next pattern's, and so on - most specific first, no repeats.
function candidates(headers, patterns) {
  const out = [];
  for (const p of patterns) {
    for (const h of headers) if (p.test(h) && !out.includes(h)) out.push(h);
  }
  return out;
}

// "Electric Rate ($/kWh)" and "Gas Intensity (Dth/ft²)" name the unit too,
// and are not usage.
const notARate = (h) => !/rate|\$|\/\s*(ft|sq)|intensity|price/i.test(h);

/**
 * Which of the list's columns feed each PRW column, in preference order.
 * A cell is read from the first of them that is non-blank on that row, so
 * a site the analysis filled and a site only the upload filled both land.
 */
export function prwSourceColumns(headers) {
  const hs = (headers || [])
    .map(h => String(h ?? '').trim())
    .filter(h => h && h !== ESTIMATED_COLUMN);
  const siteName = pickSiteNameColumn(hs);
  return {
    siteName: siteName ? [siteName] : [],
    address: candidates(hs, [
      /^address$/i, /^street\s*address$/i, /^address\s*(line\s*)?1$/i, /\bstreet\b/i, /\baddress\b/i,
    ]).filter(h => !/e-?mail|web|url/i.test(h)),
    city: candidates(hs, [/^city$/i, analysisName('City'), /^town$/i, /\bcity\b/i]),
    state: candidates(hs, [
      /^state$/i, /^province$/i, /^state\s*\/\s*prov/i, analysisName('ST / Prov'), /\bstate\b/i, /\bprovince\b/i,
    ]),
    // The analysis's zip first: it is the normalized one, where the upload's
    // own column may have been read as a number and lost its leading zero.
    zip: [...new Set([...candidates(hs, [/^zip \(analysis( \d+)?\)$/i, /^zip$/i]), pickZipColumn(hs)].filter(Boolean))],
    country: candidates(hs, [/^country$/i, analysisName('Country'), /\bcountry\b/i]),
    electricSpend: candidates(hs, [
      analysisName('Total Electric Cost'), /electric.*(cost|spend)/i, /(cost|spend).*electric/i,
    ]),
    electricUsage: candidates(hs, [
      analysisName('Annual Electric (kWh)'), /electric.*\bkwh\b/i, /\bkwh\b/i,
    ]).filter(notARate),
    electricAccounts: candidates(hs, [/electric.*accounts?$/i, /^power\s*accounts?$/i]),
    gasSpend: candidates(hs, [
      analysisName('Total Natural Gas Cost'), /gas.*(cost|spend)/i, /(cost|spend).*gas/i,
    ]),
    gasUsage: candidates(hs, [
      analysisName('Annual Gas (Dth)'), /gas.*\b(dth|mmbtu)\b/i,
    ]).filter(notARate),
    gasAccounts: candidates(hs, [/gas.*accounts?$/i]),
    propertyType: candidates(hs, [
      analysisName('Property Type'), /property\s*type/i, /building\s*type/i, /asset\s*type/i,
    ]),
    ownership: candidates(hs, [analysisName('Ownership'), /owned|leased|tenure|ownership/i]),
  };
}

const NUMERIC = new Set(['money', 'kwh', 'dth', 'count']);

// A numeric cell as a number. Lists carry "$1,234", "12,000 kWh" and
// plain numbers alike; anything without a digit is no answer.
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').trim();
  if (!raw || !/\d/.test(raw)) return null;
  const n = Number(raw.replace(/[^0-9.\-eE]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function estimatedSet(row) {
  const raw = String(row?.[ESTIMATED_COLUMN] ?? '').trim();
  return new Set(raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : []);
}

function firstFilled(row, cols) {
  for (const c of cols) {
    const v = row?.[c];
    if (v !== null && v !== undefined && String(v).trim() !== '') return { col: c, value: v };
  }
  return null;
}

/**
 * One output row per site:
 *
 *   { siteName: { value, estimated }, address: {...}, ... }
 *
 * `value` is null where the list has nothing for that site. Rows with no
 * site name are skipped, the same rule the Site Detail sheet uses.
 */
export function prwSiteListRows(list) {
  const src = prwSourceColumns(list?.headers);
  const out = [];
  for (const row of (list?.rows || [])) {
    if (!row || typeof row !== 'object') continue;
    const est = estimatedSet(row);
    const rec = {};
    for (const col of PRW_COLUMNS) {
      const hit = firstFilled(row, src[col.key] || []);
      let value = hit ? hit.value : null;
      if (value !== null && NUMERIC.has(col.kind)) value = toNumber(value);
      else if (value !== null) value = stripDashes(String(value).trim());
      rec[col.key] = { value, estimated: !!hit && value !== null && est.has(hit.col) };
    }
    if (!rec.siteName.value) continue;
    // A Canadian / UK postal code halved across City and Zip, with the
    // real city and province left in the address, is put back together,
    // so the site lands on the right country and in the summary's region.
    const loc = repairSiteLocation({
      address: rec.address.value, city: rec.city.value, state: rec.state.value,
      zip: rec.zip.value, country: rec.country.value,
    });
    for (const key of loc.changed) rec[key] = { value: loc[key] || null, estimated: false };
    // Accounts the list doesn't carry come from the property type, under
    // the site's tenure (a leased office's gas is often the landlord's).
    const needAccounts = rec.electricAccounts.value === null || rec.gasAccounts.value === null;
    if (needAccounts) {
      const type = firstFilled(row, src.propertyType)?.value;
      const tenure = firstFilled(row, src.ownership)?.value;
      const acc = type ? accountsForTenure(tenure, type) : null;
      if (acc) {
        for (const [key, commodity] of [['electricAccounts', 'electric'], ['gasAccounts', 'gas']]) {
          const n = acc[commodity]?.count;
          if (rec[key].value === null && typeof n === 'number' && Number.isFinite(n)) {
            rec[key] = { value: n, estimated: true };
          }
        }
      }
    }
    out.push(rec);
  }
  return out;
}

/** How many filled cells are estimated vs actual, for the Legend sheet. */
export function prwEstimateTally(rows) {
  let est = 0, act = 0;
  for (const r of rows) {
    for (const col of PRW_COLUMNS) {
      if (!NUMERIC.has(col.kind) || r[col.key].value === null) continue;
      if (r[col.key].estimated) est += 1; else act += 1;
    }
  }
  return { estimated: est, actual: act };
}

// The three columns of the PRW summary table, in its order.
export const PRW_REGIONS = [
  { key: NORTH_AMERICA, label: 'North America' },
  { key: EUROPE, label: 'Europe' },
  { key: REST_OF_WORLD, label: 'ROW' },
];

/**
 * The PRW summary table, worked out from the site rows:
 *
 *   { facilities, power, gas: { [region]: n },
 *     powerEstimated, gasEstimated: { [region]: bool },
 *     unplaced }
 *
 * A site's region comes from its country, else its US state / Canadian
 * province, through the same rules the Corporate Compliance page counts
 * regions by. A site with neither can't be placed in a column, so it is
 * counted in `unplaced` rather than guessed into one. A region's account
 * total is estimated when any site in it contributed an estimate.
 */
export function prwRegionSummary(rows) {
  const zero = () => Object.fromEntries(PRW_REGIONS.map(r => [r.key, 0]));
  const no = () => Object.fromEntries(PRW_REGIONS.map(r => [r.key, false]));
  const out = { facilities: zero(), power: zero(), gas: zero(), powerEstimated: no(), gasEstimated: no(), unplaced: 0 };
  for (const r of rows) {
    const { region } = siteRegionOf({ country: r.country.value || '', state: r.state.value || '' });
    if (!(region in out.facilities)) { out.unplaced += 1; continue; }
    out.facilities[region] += 1;
    for (const [field, total, est] of [['electricAccounts', 'power', 'powerEstimated'], ['gasAccounts', 'gas', 'gasEstimated']]) {
      const { value, estimated } = r[field];
      if (value === null) continue;
      out[total][region] += value;
      if (estimated) out[est][region] = true;
    }
  }
  // Accounts can be fractional per site (a "0 – 1" is 0.5); the totals are
  // read as counts, so they are rounded once, here, rather than per site.
  for (const k of ['power', 'gas']) {
    for (const reg of PRW_REGIONS) out[k][reg.key] = Math.round(out[k][reg.key] * 10) / 10;
  }
  return out;
}

export function prwSiteListFilename(company, date = new Date()) {
  const safe = String(company || 'company')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'company';
  const d = new Date(date);
  const stamp = isNaN(d) ? '' : `_${d.toISOString().slice(0, 10)}`;
  return `${safe}_PRW_Site_List${stamp}.xlsx`;
}

// Estimated cells: italic amber on a pale amber fill, the same amber the
// Master Analysis uses for modeled figures, so the two files read alike.
const EST_FONT = 'FFB45309';
const EST_FILL = 'FFFEF3C7';
const GRID = 'FFD9D9D9';

// The second tab: PRW's facilities / accounts-by-service table, filled in
// from the site rows on the first. Laid out and coloured like the PRW
// template - the spare service rows are kept blank for services this
// list has no figures for, and Total adds up whatever is in them.
const SUM_GREEN = 'FFD8E4BC';
const SUM_BLUE = 'FFDAEEF3';
const SUM_YELLOW = 'FFFFFFCC';
const SUM_ORANGE = 'FFFCD5B4';
const SUM_BORDER = 'FF808080';
const SERVICE_ROWS = 8; // Power, Natural Gas, six spare

function addPrwSummarySheet(wb, rows) {
  const sum = prwRegionSummary(rows);
  const ws = wb.addWorksheet('Facilities & Accounts');
  ws.columns = [{ width: 8 }, { width: 14 }, ...PRW_REGIONS.map(() => ({ width: 16 }))];
  const thin = { style: 'thin', color: { argb: SUM_BORDER } };
  const box = { top: thin, bottom: thin, left: thin, right: thin };
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const font = (extra = {}) => ({ name: 'Calibri', size: 11, ...extra });
  const lastCol = 2 + PRW_REGIONS.length;
  const firstService = 3;
  const totalRow = firstService + SERVICE_ROWS;

  // Row 1: Country/Region → | North America | Europe | ROW
  ws.mergeCells(1, 1, 1, 2);
  const corner = ws.getCell(1, 1);
  corner.value = 'Country/Region →';
  corner.font = font({ bold: true });
  corner.fill = fill(SUM_GREEN);
  corner.alignment = { horizontal: 'center', vertical: 'middle' };
  PRW_REGIONS.forEach((reg, i) => {
    const c = ws.getCell(1, 3 + i);
    c.value = reg.label;
    c.font = font({ bold: true });
    c.fill = fill(SUM_BLUE);
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  ws.getRow(1).height = 30;

  // Row 2: # of Facilities →
  ws.mergeCells(2, 1, 2, 2);
  const facLabel = ws.getCell(2, 1);
  facLabel.value = '# of Facilities →';
  facLabel.font = font();
  facLabel.fill = fill(SUM_YELLOW);
  facLabel.alignment = { horizontal: 'center', vertical: 'middle' };
  PRW_REGIONS.forEach((reg, i) => {
    const c = ws.getCell(2, 3 + i);
    c.value = sum.facilities[reg.key];
    c.numFmt = '#,##0';
    c.font = font();
    c.fill = fill(SUM_YELLOW);
    c.alignment = { horizontal: 'center' };
  });

  // Rows 3-10: # of Accounts by Service ↓, one service per row.
  ws.mergeCells(firstService, 1, totalRow, 1);
  const svcLabel = ws.getCell(firstService, 1);
  // Rotated 90°, so the down arrow reads as the template's right arrow.
  svcLabel.value = '# of Accounts by Service\n↓';
  svcLabel.font = font();
  svcLabel.fill = fill(SUM_ORANGE);
  svcLabel.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90, wrapText: true };
  const services = [
    ['Power', 'power', 'powerEstimated'],
    ['Natural Gas', 'gas', 'gasEstimated'],
  ];
  for (let i = 0; i < SERVICE_ROWS; i += 1) {
    const r = firstService + i;
    const [label, key, estKey] = services[i] || [];
    const name = ws.getCell(r, 2);
    name.value = label || null;
    name.font = font();
    name.fill = fill(SUM_ORANGE);
    PRW_REGIONS.forEach((reg, j) => {
      const c = ws.getCell(r, 3 + j);
      c.fill = fill(SUM_ORANGE);
      c.alignment = { horizontal: 'center' };
      c.numFmt = '#,##0.#;-#,##0.#;0';
      if (!key) { c.font = font(); return; }
      c.value = sum[key][reg.key];
      // Same marking as the first tab: italic amber when any site behind
      // the figure was an estimate.
      c.font = sum[estKey][reg.key] ? font({ italic: true, color: { argb: EST_FONT } }) : font();
    });
  }

  // Total: a live SUM, so a figure typed into a spare service row counts.
  const totalLabel = ws.getCell(totalRow, 2);
  totalLabel.value = 'Total';
  totalLabel.font = font();
  totalLabel.fill = fill(SUM_ORANGE);
  PRW_REGIONS.forEach((reg, j) => {
    const col = 3 + j;
    const letter = String.fromCharCode(64 + col);
    const c = ws.getCell(totalRow, col);
    c.value = {
      formula: `SUM(${letter}${firstService}:${letter}${totalRow - 1})`,
      result: Math.round((sum.power[reg.key] + sum.gas[reg.key]) * 10) / 10,
    };
    c.numFmt = '#,##0.#;-#,##0.#;0';
    c.font = font();
    c.fill = fill(SUM_ORANGE);
    c.alignment = { horizontal: 'center' };
  });

  for (let r = 1; r <= totalRow; r += 1) {
    for (let col = 1; col <= lastCol; col += 1) ws.getCell(r, col).border = box;
  }

  // Under the table: what it was built from, and anything left out of it.
  const notes = [
    `Built from the ${rows.length} site${rows.length === 1 ? '' : 's'} on the PRW Site List tab. Region comes from each site's country, else its US state or Canadian province. Mexico counts as North America.`,
    'Italic amber account totals include estimated accounts (from property type); see the Legend tab.',
  ];
  if (sum.unplaced) {
    notes.push(`${sum.unplaced} site${sum.unplaced === 1 ? ' has' : 's have'} no country or recognized state, so ${sum.unplaced === 1 ? 'it is' : 'they are'} not counted in any column.`);
  }
  notes.forEach((text, i) => {
    const r = totalRow + 2 + i;
    ws.mergeCells(r, 1, r, lastCol);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = font({ size: 9, italic: true, color: { argb: 'FF64748B' } });
    c.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = text.length > 90 ? 26 : 14;
  });
}

/** Build the workbook (exceljs Workbook passed in, so this stays testable). */
export function buildPrwSiteListWorkbook(Workbook, list, company) {
  const rows = prwSiteListRows(list);
  const wb = new Workbook();
  const ws = wb.addWorksheet('PRW Site List', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = PRW_COLUMNS.map(c => ({ width: c.width }));
  const border = {
    top: { style: 'thin', color: { argb: GRID } },
    bottom: { style: 'thin', color: { argb: GRID } },
    left: { style: 'thin', color: { argb: GRID } },
    right: { style: 'thin', color: { argb: GRID } },
  };

  // Header: bold, underlined, centered, as in the PRW template.
  const header = ws.getRow(1);
  PRW_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: 'Calibri', size: 11, bold: true, underline: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = border;
  });

  rows.forEach((r, idx) => {
    const row = ws.getRow(2 + idx);
    PRW_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const { value, estimated } = r[c.key];
      cell.value = value === null ? null : value;
      if (c.kind) cell.numFmt = PRW_NUM_FMT[c.kind];
      cell.font = estimated
        ? { name: 'Calibri', size: 11, italic: true, color: { argb: EST_FONT } }
        : { name: 'Calibri', size: 11 };
      if (estimated) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EST_FILL } };
      cell.border = border;
    });
  });
  if (rows.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + rows.length, column: PRW_COLUMNS.length } };
  }

  addPrwSummarySheet(wb, rows);

  // The key lives on its own sheet so the PRW sheet stays exactly the
  // template's twelve columns and nothing else.
  const { estimated, actual } = prwEstimateTally(rows);
  const legend = wb.addWorksheet('Legend');
  legend.columns = [{ width: 18 }, { width: 90 }];
  const lines = [
    ['PRW Site List', `${company || 'Company'} · ${rows.length} site${rows.length === 1 ? '' : 's'}`],
    [],
    ['Actual', 'Upright black on white: taken from the uploaded site list or a bill.'],
    ['Estimated', 'Italic amber on amber fill: modeled by the Utility Lookup analysis.'],
    [],
    ['Spend', 'Estimated where no actual spend was uploaded: usage × the indicative state / country rate.'],
    ['Usage', 'Estimated where no consumption was uploaded: modeled from the property type and size. Electric in kWh, gas in Dth.'],
    ['Accounts', 'Estimated from the property type and whether the site is owned or leased, unless the list carries its own account counts. Fractions are portfolio expectations (a "0 – 1" counts as 0.5).'],
    [],
    ['Data points', `${actual} actual, ${estimated} estimated (spend, usage and accounts cells that hold a value).`],
  ];
  lines.forEach((l, i) => {
    const row = legend.getRow(1 + i);
    l.forEach((v, j) => { row.getCell(j + 1).value = v; });
    row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
    row.getCell(2).font = { name: 'Calibri', size: 11 };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  });
  legend.getCell('A1').font = { name: 'Calibri', size: 13, bold: true };
  const estLabel = legend.getCell('A4');
  estLabel.font = { name: 'Calibri', size: 11, bold: true, italic: true, color: { argb: EST_FONT } };
  estLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EST_FILL } };

  sanitizeExcelWorkbook(wb);
  return { wb, rows };
}

export async function downloadPrwSiteList(list, company, date = new Date()) {
  const { Workbook } = await import('exceljs');
  const { wb } = buildPrwSiteListWorkbook(Workbook, list, company);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = prwSiteListFilename(company, date);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
