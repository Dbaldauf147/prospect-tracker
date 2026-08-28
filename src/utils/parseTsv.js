// Tab-separated clipboard parser for the Excel / Google-Sheets paste format.
//
// A cell containing a newline, tab, or quote arrives wrapped in double
// quotes with its internal quotes doubled, so a naive split('\t') tears
// multi-line notes into fragments and shifts every column after them.
//
// Lifted from the identical parser inside SiteListPasteModal (itself a copy
// of DealsView's) so a third paste flow doesn't add a third copy. Those two
// are left alone deliberately — both work, and rewiring a working import
// path is not worth the risk of this change.

// Parse `text` into a header row plus data rows.
// Returns { headers: string[], rows: string[][] }.
export function parseTsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"' && !cellStarted) { inQuotes = true; cellStarted = true; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; cellStarted = false; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; cellStarted = false; continue; }
    cell += ch;
    cellStarted = true;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  while (rows.length > 0 && rows[rows.length - 1].every(c => c === '')) rows.pop();
  if (rows.length === 0) return { headers: [], rows: [] };
  return { headers: rows[0].map(h => String(h || '').trim()), rows: rows.slice(1) };
}

// Normalise a header for alias matching: lowercase, letters and digits only,
// so "Don't Track", "dont_track" and "DONT TRACK" all collapse together.
export function normHeader(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Read a checkbox column. Spreadsheets spell these a dozen ways; anything
// unrecognised (including an empty cell) returns null, which callers treat
// as "no value given" rather than as false — an import that restores data
// must never turn a blank cell into a deliberate "unticked".
const TRUE_WORDS = new Set(['y', 'yes', 'true', 't', 'x', '1', 'checked', '✓', '✔', 'yep', 'done']);
const FALSE_WORDS = new Set(['n', 'no', 'false', 'f', '0', 'unchecked', '-', '–']);

export function parseBooleanCell(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return null;
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return null;
}
