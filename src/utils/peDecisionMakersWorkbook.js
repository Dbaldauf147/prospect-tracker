// "Export PE Decision Makers" on the PE Portfolio page's PE Overview tab:
// every contact tagged Decision Maker who works AT a PE firm on the roster
// (Type = Private Equity), one row per person, grouped by firm, in the
// Schneider-branded layout the page's other exports use (green title band,
// dark-green header, Nunito Sans, zebra rows). Firms with nobody tagged get
// a second sheet, so the gaps are in the file too.
//
// Rows are built by the page (it owns the firm <-> contact matching); this
// module only turns them into a workbook.

import { sanitizeExcelWorkbook } from './exportSanitize.js';

const SE_GREEN = 'FF3DCD58';
const SE_GREEN_DARK = 'FF009530';
const SE_BORDER = 'FFD4DDE1';
const SE_TEXT = 'FF1E293B';
const SE_MUTED = 'FF64748B';
const ZEBRA = 'FFF1F8F4';
const BODY_FONT = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT } };

export const PE_DM_COLUMNS = [
  { key: 'firm', label: 'PE Firm', width: 30 },
  { key: 'peStage', label: 'PE Stage', width: 16 },
  { key: 'cdm', label: 'CDM', width: 18 },
  { key: 'name', label: 'Name', width: 24 },
  { key: 'title', label: 'Title', width: 32 },
  { key: 'email', label: 'Email', width: 32 },
  { key: 'phone', label: 'Phone', width: 18 },
  { key: 'cityCountry', label: 'City, Country', width: 24 },
  { key: 'linkedin', label: 'LinkedIn', width: 16 },
  { key: 'metInPerson', label: 'Met In Person', width: 14 },
  { key: 'primaryPoc', label: 'Primary POC', width: 14 },
];

const NO_DM_COLUMNS = [
  { key: 'firm', label: 'PE Firm', width: 34 },
  { key: 'peStage', label: 'PE Stage', width: 16 },
  { key: 'cdm', label: 'CDM', width: 18 },
];

function linkHref(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function addSheet(wb, { name, subtitle, columns, rows }) {
  const ws = wb.addWorksheet(name.slice(0, 31), {
    properties: { tabColor: { argb: SE_GREEN } },
    views: [{ state: 'frozen', ySplit: 3 }],
  });
  ws.columns = columns.map(c => ({ width: c.width }));
  const n = columns.length;

  ws.mergeCells(1, 1, 1, n);
  const title = ws.getCell(1, 1);
  title.value = 'Schneider Electric';
  title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, n);
  const sub = ws.getCell(2, 1);
  sub.value = subtitle;
  sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_MUTED } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  const border = {
    top: { style: 'thin', color: { argb: SE_BORDER } },
    bottom: { style: 'thin', color: { argb: SE_BORDER } },
    left: { style: 'thin', color: { argb: SE_BORDER } },
    right: { style: 'thin', color: { argb: SE_BORDER } },
  };
  const header = ws.getRow(3);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    cell.border = border;
  });
  header.height = 26;

  // Zebra by firm rather than by row, so one firm's people read as a block.
  let band = 0;
  let lastFirm = null;
  rows.forEach((row, ri) => {
    if (row.firm !== lastFirm) { if (lastFirm !== null) band ^= 1; lastFirm = row.firm; }
    const r = ws.getRow(4 + ri);
    columns.forEach((c, ci) => {
      const cell = r.getCell(ci + 1);
      const v = row[c.key];
      if (c.key === 'linkedin' && v) {
        cell.value = { text: 'Profile', hyperlink: linkHref(v) };
        cell.font = { ...BODY_FONT, color: { argb: 'FF0A66C2' }, underline: true };
      } else if (c.key === 'email' && v) {
        cell.value = { text: v, hyperlink: `mailto:${v}` };
        cell.font = { ...BODY_FONT, color: { argb: 'FF0A66C2' } };
      } else {
        cell.value = v === '' || v == null ? null : v;
        cell.font = c.key === 'firm' || c.key === 'name' ? { ...BODY_FONT, bold: true } : BODY_FONT;
      }
      cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
      if (band) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      cell.border = border;
    });
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: n } };
  return ws;
}

/**
 * @param {object} args
 * @param {Array} args.rows       one per decision maker: { firm, peStage, cdm, name, title, email, phone, cityCountry, linkedin, metInPerson, primaryPoc }
 * @param {Array} args.firmsWithout firms with no decision maker: { firm, peStage, cdm }
 * @param {number} args.firmCount  how many firms were looked at
 * @returns {Promise<Workbook>}
 */
export async function buildPeDecisionMakersWorkbook({ rows = [], firmsWithout = [], firmCount = 0 }) {
  const mod = await import('exceljs');
  const Workbook = mod.Workbook || mod.default?.Workbook;
  const wb = new Workbook();
  wb.creator = 'Schneider Electric · Prospect Tracker';
  wb.created = new Date();
  const firmsWith = new Set(rows.map(r => r.firm)).size;
  addSheet(wb, {
    name: 'PE Decision Makers',
    subtitle: `PE Decision Makers · ${rows.length} contact${rows.length === 1 ? '' : 's'} at ${firmsWith} of ${firmCount} PE firm${firmCount === 1 ? '' : 's'}`,
    columns: PE_DM_COLUMNS,
    rows,
  });
  addSheet(wb, {
    name: 'Firms Without a DM',
    subtitle: `PE firms with nobody tagged Decision Maker · ${firmsWithout.length}`,
    columns: NO_DM_COLUMNS,
    rows: firmsWithout,
  });
  sanitizeExcelWorkbook(wb);
  return wb;
}

export async function downloadPeDecisionMakersWorkbook(args) {
  const wb = await buildPeDecisionMakersWorkbook(args);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pe_decision_makers_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
