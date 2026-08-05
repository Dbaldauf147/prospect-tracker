// Keep the em dash (—, U+2014) out of anything the app EXPORTS or DOWNLOADS.
//
// Every generated file (exceljs / SheetJS workbooks, CSV blobs, .docx/.eml
// HTML, and download filenames) should read with a plain hyphen instead of an
// em dash. Rather than hunt every hardcoded string, each export path runs its
// finished output through one of these helpers at the write boundary — so
// strings added upstream later are covered automatically. Mirrors the
// long-standing dashFix used by the Indicative Site Analysis export.

const EM_DASH = /-/g;

// Plain string → em dashes replaced with hyphens. Non-strings pass through
// untouched so callers can pipe cell values / filenames of any type.
export function stripDashes(s) {
  return typeof s === 'string' ? s.replace(EM_DASH, '-') : s;
}

// exceljs Workbook: normalize every populated cell in place — plain strings,
// richText runs, shared-string { text }, and cached formula { result }.
// Call right before wb.xlsx.writeBuffer().
export function sanitizeExcelWorkbook(wb) {
  if (!wb || typeof wb.eachSheet !== 'function') return wb;
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (typeof v === 'string') {
          cell.value = stripDashes(v);
        } else if (v && typeof v === 'object') {
          if (Array.isArray(v.richText)) {
            v.richText.forEach((run) => { run.text = stripDashes(run.text); });
            cell.value = v;
          } else if (typeof v.text === 'string') {
            cell.value = { ...v, text: stripDashes(v.text) };
          } else if (typeof v.result === 'string') {
            cell.value = { ...v, result: stripDashes(v.result) };
          }
        }
      });
    });
  });
  return wb;
}

// SheetJS workbook: walk every data cell and de-dash its value (.v) and any
// pre-formatted text (.w). Call right before XLSX.writeFile(wb, ...).
export function sanitizeSheetJsWorkbook(wb) {
  if (!wb || !Array.isArray(wb.SheetNames)) return wb;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || typeof ws !== 'object') continue;
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue;
      const cell = ws[addr];
      if (!cell) continue;
      if (typeof cell.v === 'string') cell.v = stripDashes(cell.v);
      if (typeof cell.w === 'string') cell.w = stripDashes(cell.w);
    }
  }
  return wb;
}
