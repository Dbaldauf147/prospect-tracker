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

// Find the first row that looks like a header: a label-ish cell
// (string, not a bare number) followed by at least one subsequent row
// with data in any of the same columns. We used to require 2+
// non-empty cells, which rejected legitimate single-column files
// (common for list exports like CA SB entity-name rosters).
function findHeaderRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] || [];
    const nonEmptyCount = nonEmpty(row);
    if (nonEmptyCount < 1) continue;
    const hasLabel = row.some(c => typeof c === 'string' && c.trim().length > 0 && !/^[\d.,\-$]+$/.test(c.trim()));
    if (!hasLabel) continue;
    // Confirm this isn't just a title row by checking that some later
    // row (within a small window) carries data. A single-column file
    // with "Entity Name" then 4,000 company names passes this check;
    // a one-line title with nothing below it fails.
    for (let j = i + 1; j < Math.min(rows.length, i + 6); j++) {
      if (nonEmpty(rows[j] || []) > 0) return i;
    }
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

// Detects the two-tab Utility Lookup template (one "Electric Power"
// sheet + one "Gas" / "Natural Gas" sheet sharing a Site Name
// column) and returns the merged rows + union of headers. Returns
// `null` when the workbook doesn't look like that template, so the
// caller can fall back to parseBestSheet. Common columns (Site Name,
// Zip, Country) are deduplicated; commodity-specific columns from
// both sheets are preserved in document order. Rows are matched
// case-insensitively on Site Name, and the first non-empty value
// wins when a common column appears on both tabs.
export function parseSplitSitesTemplate(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  if (!wb.SheetNames?.length) return null;
  const electricName = wb.SheetNames.find(n => /^electric(\s*power)?$/i.test(String(n).trim()));
  const gasName = wb.SheetNames.find(n => /^(natural\s*)?gas$/i.test(String(n).trim()));
  if (!electricName || !gasName) return null;
  const electric = parseSheet(wb.Sheets[electricName], electricName);
  const gas = parseSheet(wb.Sheets[gasName], gasName);
  if (electric.rows.length === 0 && gas.rows.length === 0) return null;

  const findSiteCol = (headers) => headers.find(h => /^site\s*name$/i.test(String(h).trim())) || headers[0];
  const elecSiteCol = findSiteCol(electric.headers);
  const gasSiteCol = findSiteCol(gas.headers);
  const normKey = (s) => String(s ?? '').trim().toLowerCase();

  // Union of headers: electric first, then any gas headers that
  // aren't already present (the common columns appear in electric).
  const headers = [...electric.headers];
  for (const h of gas.headers) {
    if (!headers.includes(h)) headers.push(h);
  }

  // Merge by Site Name. First sheet to mention a site sets the row
  // order; subsequent rows for the same site fill in any blank cells.
  const merged = new Map();
  let order = 0;
  const ingest = (sourceRows, sourceSiteCol) => {
    for (const r of sourceRows) {
      const key = normKey(r[sourceSiteCol]);
      if (!key) continue;
      let entry = merged.get(key);
      if (!entry) {
        entry = { row: {}, order: order++ };
        for (const h of headers) entry.row[h] = '';
        merged.set(key, entry);
      }
      for (const h of headers) {
        const v = r[h];
        if (v == null || v === '') continue;
        if (entry.row[h] == null || entry.row[h] === '') entry.row[h] = v;
      }
    }
  };
  ingest(electric.rows, elecSiteCol);
  ingest(gas.rows, gasSiteCol);

  const rows = Array.from(merged.values())
    .sort((a, b) => a.order - b.order)
    .map(e => e.row);

  return {
    sheetName: `${electricName} + ${gasName}`,
    headers,
    rows,
  };
}

// Parses every sheet in an xlsx/csv buffer and returns the ones that
// have at least one data row. Used by the Sites column-mapping modal
// so the user can pick which tab to map. Order matches the workbook's
// own SheetNames order. Sheets whose name starts with `__` are
// reserved for internal round-trip state and never surface to the UI.
export function parseAllSheets(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  if (!wb.SheetNames?.length) return [];
  const out = [];
  for (const name of wb.SheetNames) {
    if (String(name).startsWith('__')) continue;
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    try {
      const parsed = parseSheet(sheet, name);
      if (parsed.rows.length > 0) out.push(parsed);
    } catch {
      // Skip unparseable sheets silently — the user picks from the
      // ones that worked.
    }
  }
  return out;
}

// Every sheet name the workbook declares, in workbook order — including
// sheets whose data couldn't be read. Names live in workbook.xml rather
// than in the per-sheet entries, so a workbook rebuilt without a damaged
// sheet still knows what that sheet was called. That's what lets a salvage
// report name the tab it lost instead of "sheet 3".
export function readSheetNames(buffer) {
  try {
    return XLSX.read(buffer, { type: 'array', bookSheets: true }).SheetNames || [];
  } catch {
    return [];
  }
}

// Reads the hidden `__rt_state__` sheet that the Indicative Savings
// export writes to round-trip page state (vendor decisions, etc.).
// Returns the parsed JSON or null when the sheet / cell is missing or
// unreadable. The hidden sheet has a single cell at A1 with a JSON
// payload, so this dodges parseSheet's header-row heuristic entirely.
export function readRoundTripState(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets?.['__rt_state__'];
  if (!sheet) return null;
  const cell = sheet['A1'];
  const raw = cell?.v;
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// Returns true when the workbook looks like an Indicative Savings
// export (carries the distinctive 'Site Detail' + 'Methodology' tabs
// alongside a 'Site List' tab). Used to bias the column-mapping
// modal's default tab selection.
export function isIndicativeSavingsExport(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const names = new Set((wb.SheetNames || []).map(n => String(n)));
  return names.has('Site List') && (names.has('Site Detail') || names.has('Methodology'));
}

// Parses an xlsx/csv buffer and returns the sheet with the most rows.
// If `options.preferSheetName` is a regex, any sheet whose name
// matches and parses with >0 rows wins over the raw row-count leader —
// useful when you're looking for a specific tab (e.g. "Site List")
// inside a multi-sheet workbook that might have a larger-but-irrelevant
// tab next to it. Throws with a descriptive message when no sheet has
// data.
export function parseBestSheet(buffer, options = {}) {
  const { preferSheetName } = options;
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
  if (preferSheetName instanceof RegExp) {
    const preferred = attempts.find(a => a.rows.length > 0 && preferSheetName.test(a.sheetName));
    if (preferred) return preferred;
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
