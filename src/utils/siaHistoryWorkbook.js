// One SIA History entry as an Excel workbook, for the Download button on
// the SIA History subtab. Four sheets:
//   Summary     - the file, when it was loaded, and one row per option
//   Details     - every header-block line (Date, Salesperson, Client, ...)
//   Cost Lines  - every cost line on every option
//   Alt Fees    - the SIA's own alternative fee rows, when it had any
// Money and percentages go in as numbers with a cell format, so the sheet
// can still be summed and filtered.

import * as XLSX from 'xlsx';
import { siaHistorySummary } from './siaHistoryEntry.js';

const MONEY = '"$"#,##0.00';
const PCT = '0.0%';

function sheetFrom(rows, { widths = [], formats = {} } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map(wch => ({ wch }));
  // formats: { [columnIndex]: numFmt }, applied to numeric cells below the header.
  for (let r = 1; r < rows.length; r++) {
    for (const [c, z] of Object.entries(formats)) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: Number(c) })];
      if (cell && cell.t === 'n') cell.z = z;
    }
  }
  return ws;
}

const optName = (o) => o.sheetName || `Option ${o.optionNumber}`;
const orBlank = (v) => (v == null ? '' : v);

export function buildSiaHistoryWorkbook(entry) {
  const wb = XLSX.utils.book_new();
  const options = entry?.options || [];
  const s = siaHistorySummary(entry);
  const loaded = new Date(entry?.loadedAt || 0);

  const summary = [
    ['File', entry?.fileName || ''],
    ['Loaded', Number.isNaN(loaded.getTime()) ? '' : loaded.toLocaleString('en-US')],
    ['Salesperson', s.salesperson],
    ['Cost lines', s.costLines],
    ['Total CTS', s.ctsTotal],
    [],
    ['Option', 'Hidden', 'Sites', 'Accounts', 'Target GM%', 'Use Target', 'Solution description', 'Cost lines', 'Total CTS'],
    ...options.map(o => [
      optName(o),
      o.hidden ? 'Yes' : '',
      orBlank(o.siteCount),
      orBlank(o.accountCount),
      orBlank(o.targetGmPct),
      o.useTargetGm == null ? '' : (o.useTargetGm ? 'Yes' : 'No'),
      o.solutionDescription || '',
      (o.costItems || []).length,
      (o.costItems || []).reduce((t, it) => t + (typeof it.cts === 'number' ? it.cts : 0), 0),
    ]),
  ];
  const summaryWs = sheetFrom(summary, { widths: [22, 10, 10, 10, 12, 11, 40, 11, 14] });
  // The header block above the option table has its own formats.
  const totalCell = summaryWs[XLSX.utils.encode_cell({ r: 4, c: 1 })];
  if (totalCell) totalCell.z = MONEY;
  for (let r = 7; r < summary.length; r++) {
    const pct = summaryWs[XLSX.utils.encode_cell({ r, c: 4 })];
    if (pct?.t === 'n') pct.z = PCT;
    const money = summaryWs[XLSX.utils.encode_cell({ r, c: 8 })];
    if (money?.t === 'n') money.z = MONEY;
  }
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  const details = [['Option', 'Label', 'Value']];
  for (const o of options) {
    for (const d of o.headerDetails || []) details.push([optName(o), d.label, d.value]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFrom(details, { widths: [14, 28, 50] }), 'Details');

  const lines = [['Option', 'Section', 'Line Item', 'Type', 'CTS', 'GM%', 'Start Month', 'Comments']];
  for (const o of options) {
    for (const it of o.costItems || []) {
      lines.push([optName(o), it.section, it.description, it.type, orBlank(it.cts), orBlank(it.gmPct), it.startMonth, it.comments]);
    }
  }
  XLSX.utils.book_append_sheet(wb, sheetFrom(lines, {
    widths: [14, 24, 40, 18, 14, 8, 12, 40],
    formats: { 4: MONEY, 5: PCT },
  }), 'Cost Lines');

  const fees = [['Option', 'Alternative Fee', 'Type', 'Fee', 'Unit', 'Units', 'Start Month']];
  for (const o of options) {
    for (const a of o.altFees || []) {
      fees.push([optName(o), a.altItem, a.type, orBlank(a.fee), a.unit, orBlank(a.unitCount), orBlank(a.startMonth)]);
    }
  }
  if (fees.length > 1) {
    XLSX.utils.book_append_sheet(wb, sheetFrom(fees, { widths: [14, 32, 20, 14, 14, 8, 12], formats: { 3: MONEY } }), 'Alt Fees');
  }
  return wb;
}

// "Acme SIA v2.xlsx" loaded on Sep 29 → "Acme SIA v2 (history 2026-09-29).xlsx"
export function siaHistoryFileName(entry) {
  const base = String(entry?.fileName || 'SIA').replace(/\.xls[xm]?$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'SIA';
  const d = new Date(entry?.loadedAt || 0);
  const day = Number.isNaN(d.getTime()) ? '' : ` ${d.toISOString().slice(0, 10)}`;
  return `${base} (history${day}).xlsx`;
}
