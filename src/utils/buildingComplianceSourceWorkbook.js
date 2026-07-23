// Building Compliance Screening — source download.
//
// The screening source is kept on-device as a compact
// { compCols, profiles, index } dataset rather than the original file
// bytes. For a user-uploaded workbook we round-trip the exact bytes that
// were uploaded (see screeningSourceStore), but the bundled default has no
// original file — so this reconstructs a plain, re-uploadable workbook from
// the dataset: one row per place identifier, with each requirement column
// alongside it.
//
// Headers live on row 1 with no title band, so the result parses cleanly if
// it's uploaded back in as a replacement source (parseBestSheet treats the
// first column as the city + state identifier).

import { sanitizeExcelWorkbook } from './exportSanitize.js';

const HEADER_FILL = 'FF009530';   // Schneider "Life is On" green
const HEADER_FG = 'FFFFFFFF';
const TEXT_DARK = 'FF1E293B';
const ZEBRA = 'FFF6F9F4';

// Trigger a browser download for a blob.
function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Download exact uploaded bytes when we have them.
export function downloadSourceBytes({ buffer, name, type }) {
  const blob = new Blob([buffer], {
    type: type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerBlobDownload(blob, name || 'Building Compliance Screening source.xlsx');
}

// Rebuild a workbook from the compact dataset (built-in list / legacy source).
export async function downloadComplianceSourceWorkbook({ sourceName = '', dataset }) {
  if (!dataset || !dataset.index || !dataset.profiles) {
    alert('No source data available to download.');
    return;
  }

  const compCols = dataset.compCols || [];
  const headers = ['City + State', ...compCols];
  // One row per place identifier, sorted for a stable, browsable file.
  const keys = Object.keys(dataset.index).sort();

  try {
    const exceljs = await import('exceljs');
    const Workbook = exceljs.Workbook || (exceljs.default && exceljs.default.Workbook);
    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    const ws = wb.addWorksheet('Compliance Source', {
      views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }],
    });
    ws.columns = [{ width: 34 }, ...compCols.map(() => ({ width: 30 }))];

    // Row 1: column headers (also the parseable header row on re-upload).
    const headerRow = ws.getRow(1);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { name: 'Nunito Sans', bold: true, color: { argb: HEADER_FG }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    });
    headerRow.height = 26;

    keys.forEach((key, idx) => {
      const pid = dataset.index[key];
      const profile = dataset.profiles[pid] || {};
      const vals = [key, ...compCols.map(col => profile[col] ?? '')];
      const row = ws.getRow(2 + idx);
      const zebra = idx % 2 === 1;
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v === '' || v == null ? null : v;
        cell.font = { name: 'Nunito Sans', size: 10, color: { argb: TEXT_DARK } };
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: i > 0 };
        if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      });
    });

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

    sanitizeExcelWorkbook(wb);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const base = sourceName && sourceName !== 'Built-in compliance list'
      ? sourceName.replace(/\.(xlsx|xls|csv)$/i, '')
      : 'Building Compliance Screening source';
    triggerBlobDownload(blob, `${base}.xlsx`);
  } catch (err) {
    alert('Failed to build source file: ' + (err?.message || err));
  }
}
