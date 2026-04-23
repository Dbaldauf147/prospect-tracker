// Shared xlsx parsing helpers. Real-world spreadsheets (especially
// utility-rate / regulatory data) often put the real header row below
// a title line or a blank row, or on a sheet other than the first.
// parseBestSheet() scans every sheet and picks the one with the most
// data rows after it auto-detects the header row.

import * as XLSX from 'xlsx';

function nonEmpty(row) {
  if (!Array.isArray(row)) return 0;
  let n = 0;
  for (const c of row) if (c !== '' && c != null) n++;
  return n;
}

// Find the first row that looks like a header: 2+ non-empty cells and
// at least one cell that looks label-ish (string, not a bare number).
function findHeaderRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] || [];
    const nonEmptyCount = nonEmpty(row);
    if (nonEmptyCount < 2) continue;
    const hasLabel = row.some(c => typeof c === 'string' && c.trim().length > 0 && !/^[\d.,\-$]+$/.test(c.trim()));
    if (hasLabel) return i;
  }
  return -1;
}

function parseSheet(sheet, sheetName) {
  const raw = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: true,
  });
  if (!raw.length) return { sheetName, rows: [], headers: [], reason: 'empty' };
  const headerIdx = findHeaderRowIndex(raw);
  if (headerIdx === -1) return { sheetName, rows: [], headers: [], reason: 'no header' };
  const rawHeaders = raw[headerIdx].map(h => String(h ?? '').trim());
  // Ensure column names are unique and non-empty.
  const seen = new Map();
  const headers = rawHeaders.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
  const dataRows = raw.slice(headerIdx + 1);
  const rows = [];
  for (const r of dataRows) {
    if (!r || !Array.isArray(r)) continue;
    const obj = {};
    let hasValue = false;
    for (let i = 0; i < headers.length; i++) {
      const val = r[i];
      if (val === undefined || val === null) { obj[headers[i]] = ''; continue; }
      if (val !== '') hasValue = true;
      obj[headers[i]] = val;
    }
    if (hasValue) rows.push(obj);
  }
  return { sheetName, rows, headers };
}

// Parses an xlsx/csv buffer and returns the sheet with the most rows.
// Throws with a descriptive message when no sheet has data.
export function parseBestSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  if (!wb.SheetNames?.length) throw new Error('Workbook has no sheets');
  const attempts = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    try {
      attempts.push(parseSheet(sheet, name));
    } catch (err) {
      attempts.push({ sheetName: name, rows: [], headers: [], reason: err?.message || 'parse error' });
    }
  }
  const best = attempts.reduce((a, b) => (b.rows.length > (a?.rows.length || 0) ? b : a), null);
  if (!best || best.rows.length === 0) {
    const summary = attempts
      .map(a => `"${a.sheetName}" (${a.rows.length} rows${a.reason ? `, ${a.reason}` : ''})`)
      .join(', ') || '(none)';
    throw new Error(`No data rows found. Sheets scanned: ${summary}. Check that your spreadsheet has column headers and at least one data row.`);
  }
  return best;
}
