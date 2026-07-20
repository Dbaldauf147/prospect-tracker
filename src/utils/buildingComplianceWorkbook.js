// Building Compliance Screening export.
//
// Builds a polished, Schneider-branded "Building Compliance Screening" Excel
// file from the site-list screening results. One row per site, with the
// compliance status, the count of applicable requirements, and one column per
// requirement type that actually appears in the exported set (so the grid
// stays tight instead of carrying dozens of empty requirement columns).
//
// Mirrors the branding + download idiom used by portfolioCompaniesWorkbook.js.

import { sanitizeExcelWorkbook } from './exportSanitize.js';

// Schneider Electric brand palette (shared look with the other exports).
const SE_GREEN = 'FF3DCD58';       // Life is On green (title band)
const SE_GREEN_DARK = 'FF009530';  // Header band
const SE_TEXT_DARK = 'FF1E293B';
const SE_ZEBRA = 'FFF6F9F4';
const SE_BORDER = 'FFD4DDE1';
const REQ_FILL = 'FFDCFCE7';       // "Required" — green wash
const REQ_FG = 'FF166534';
const NONE_FILL = 'FFF1F5F9';      // "None" — muted grey
const NONE_FG = 'FF475569';

// results: [{ siteName, city, state, applied: [{ col, value }] }]
// compCols: ordered master list of requirement columns from the dataset.
export async function downloadComplianceScreeningWorkbook({
  sourceName = '',
  compCols = [],
  results = [],
}) {
  if (!results.length) {
    alert('No screening results to export.');
    return;
  }

  // Keep only the requirement columns that carry a value somewhere in the
  // exported set, preserving the dataset's column order.
  const usedCols = compCols.filter(col =>
    results.some(r => (r.applied || []).some(a => a.col === col)),
  );

  const headers = ['Site', 'City', 'State', 'Compliance', 'Requirements', ...usedCols];
  const colWidths = [32, 18, 10, 14, 12, ...usedCols.map(() => 30)];

  const matched = results.filter(r => r.applied && r.applied.length).length;

  try {
    const exceljs = await import('exceljs');
    const Workbook = exceljs.Workbook || (exceljs.default && exceljs.default.Workbook);
    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    const ws = wb.addWorksheet('Compliance Screening', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 3, xSplit: 1 }],
    });
    ws.columns = colWidths.map(w => ({ width: w }));

    const titleRow = 1;
    const subRow = 2;
    const headerRowIdx = 3;

    // Row 1: Title band
    ws.mergeCells(titleRow, 1, titleRow, headers.length);
    const titleCell = ws.getCell(titleRow, 1);
    titleCell.value = 'Schneider Electric';
    titleCell.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(titleRow).height = 30;

    // Row 2: Subtitle — "Building Compliance Screening · {source} · {matched} of {total} sites with requirements"
    ws.mergeCells(subRow, 1, subRow, headers.length);
    const subCell = ws.getCell(subRow, 1);
    const srcSuffix = sourceName ? `  ·  ${sourceName}` : '';
    subCell.value = `Building Compliance Screening${srcSuffix}  ·  ${matched} of ${results.length} sites with requirements`;
    subCell.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: 'FF64748B' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(subRow).height = 20;

    // Row 3: Column headers
    const headerRow = ws.getRow(headerRowIdx);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      cell.border = {
        top: { style: 'thin', color: { argb: SE_BORDER } },
        bottom: { style: 'thin', color: { argb: SE_BORDER } },
        left: { style: 'thin', color: { argb: SE_BORDER } },
        right: { style: 'thin', color: { argb: SE_BORDER } },
      };
    });
    headerRow.height = 30;

    // Data rows — sites with requirements first (most recent-of-interest at
    // the top), each in on-screen order within its group.
    const ordered = [...results].sort((a, b) => {
      const ah = a.applied && a.applied.length ? 1 : 0;
      const bh = b.applied && b.applied.length ? 1 : 0;
      return bh - ah;
    });

    const thinBorder = { style: 'thin', color: { argb: SE_BORDER } };
    ordered.forEach((r, idx) => {
      const row = ws.getRow(headerRowIdx + 1 + idx);
      const has = r.applied && r.applied.length > 0;
      const valueByCol = new Map((r.applied || []).map(a => [a.col, a.value]));
      const vals = [
        r.siteName || '',
        r.city || '',
        r.state || '',
        has ? 'Required' : 'None',
        has ? r.applied.length : 0,
        ...usedCols.map(col => valueByCol.get(col) ?? ''),
      ];
      const zebra = idx % 2 === 1;
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v === '' || v == null ? null : v;
        cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        cell.border = { bottom: thinBorder, left: thinBorder, right: thinBorder };
        const isReqCount = i === 4;
        cell.alignment = {
          vertical: 'top',
          horizontal: isReqCount ? 'center' : 'left',
          wrapText: i >= 5,
        };
        if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_ZEBRA } };
        // Compliance column (index 3): green "Required" / muted "None".
        if (i === 3) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: has ? REQ_FILL : NONE_FILL } };
          cell.font = { ...cell.font, bold: true, color: { argb: has ? REQ_FG : NONE_FG } };
          cell.alignment = { vertical: 'top', horizontal: 'center' };
        }
        if (isReqCount) cell.numFmt = '0';
      });
      row.height = usedCols.length ? 28 : 18;
    });

    // Auto-filter on the header row so users can sort/filter immediately.
    ws.autoFilter = { from: { row: headerRowIdx, column: 1 }, to: { row: headerRowIdx, column: headers.length } };

    // Re-apply column widths after all cells are written (ExcelJS can
    // recalculate widths as cells are added via getCell()).
    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    sanitizeExcelWorkbook(wb);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Building Compliance Screening.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    alert('Failed to build Excel: ' + (err?.message || err));
  }
}
