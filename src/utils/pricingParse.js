// Parses cost data out of "Option 1/2/3/4" sheets in an uploaded fee
// workbook. Each Option sheet has a free-text "Solution description"
// up top and one or more sub-tables of line items underneath.
//
// The parser is header-anchored: it scans every row for one that
// contains a "Cost to Serve" cell (or a Description-only header for
// shared-savings sub-tables). Each such row is treated as a section
// header; everything between that header and the next one — even if
// blank rows are interspersed — is collected as line items, as long
// as the row's first cell is non-empty.
//
// Hidden sheets are read just like visible ones — XLSX preserves
// `Sheet.Hidden` (1 = hidden, 2 = very hidden) on the workbook, which
// we surface but don't filter on.

import * as XLSX from 'xlsx';

const OPTION_RE = /^\s*Option\s*([1-4])\b/i;
const COST_HEADER_RE = /cost\s*to\s*serve/i;
const SOLUTION_DESC_RE = /^solution\s*description$/i;
const SKIP_LABEL_RE = /^(target\s*gm\s*%|use\s*target|delivery\s*team\s*inputs|solution\s*description)/i;

function cellStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function rowIsBlank(row) {
  if (!Array.isArray(row)) return true;
  return row.every(c => cellStr(c) === '');
}

function rowHasHeaderCue(row) {
  if (!Array.isArray(row)) return false;
  // Treat as a header row if any cell matches "Cost to Serve" OR if
  // the row has a non-empty col 0 plus a "Description" header in cols
  // 1+ (the shared-savings layout).
  for (let i = 0; i < row.length; i++) {
    if (COST_HEADER_RE.test(cellStr(row[i]))) return true;
  }
  if (cellStr(row[0])) {
    for (let i = 1; i < row.length; i++) {
      if (/^description$/i.test(cellStr(row[i]))) return true;
    }
  }
  return false;
}

function parseOptionSheet(sheet, sheetName) {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: true,
  });

  let solutionDescription = '';
  let targetGmPct = null;

  // First pass: extract Solution description + Target GM%.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const a = cellStr(row[0]);
    if (!a) continue;
    if (SOLUTION_DESC_RE.test(a)) {
      const here = cellStr(row[1]);
      if (here) {
        solutionDescription = here;
      } else {
        // Look at the next non-blank row.
        for (let j = i + 1; j < Math.min(rows.length, i + 4); j++) {
          const next = rows[j] || [];
          const nv = cellStr(next[0]) || cellStr(next[1]);
          if (nv) { solutionDescription = nv; break; }
        }
      }
    }
    if (/target\s*gm\s*%/i.test(a)) {
      const v = (row.slice(1).map(cellStr).find(Boolean) || '');
      if (v) {
        const n = Number(String(v).replace('%', '').trim());
        if (!Number.isNaN(n)) targetGmPct = n > 1 ? n / 100 : n;
      }
    }
  }

  // Second pass: locate every header row, then collect items between
  // each pair of headers.
  const headerIdxs = [];
  for (let i = 0; i < rows.length; i++) {
    if (rowHasHeaderCue(rows[i] || [])) headerIdxs.push(i);
  }

  const sections = [];
  for (let hi = 0; hi < headerIdxs.length; hi++) {
    const idx = headerIdxs[hi];
    const headerRow = (rows[idx] || []).map(cellStr);
    const nextHeaderIdx = headerIdxs[hi + 1] ?? rows.length;

    // Section title: col 0 of the header row. If that cell is empty
    // (Cost to Serve in col 0 of an unusual layout), look back for the
    // nearest non-blank single-label row above.
    let title = headerRow[0] || '';
    if (!title) {
      for (let j = idx - 1; j >= 0 && j > (headerIdxs[hi - 1] ?? -1); j--) {
        const t = cellStr((rows[j] || [])[0]);
        if (t && !SKIP_LABEL_RE.test(t)) { title = t; break; }
      }
      if (!title) title = `Section ${hi + 1}`;
    }

    const items = [];
    for (let r = idx + 1; r < nextHeaderIdx; r++) {
      const row = rows[r] || [];
      const a = cellStr(row[0]);
      if (!a) continue;
      // Skip rows that are themselves key/value pairs (Target GM%,
      // Use Target, etc.) or section title strings.
      if (SKIP_LABEL_RE.test(a)) continue;
      if (rowIsBlank(row)) continue;
      // Skip placeholder / "Enter X here" rows.
      if (/^enter\s+.+\s+here$/i.test(a)) continue;

      const item = {
        id: `${sheetName}::${title}::${items.length}::${a.slice(0, 40)}`,
        raw: row.slice(),
        description: a,
      };
      headerRow.forEach((h, i2) => {
        if (i2 === 0) return;
        const hl = h.toLowerCase();
        const v = row[i2];
        if (/^type$/.test(hl)) item.type = cellStr(v);
        else if (COST_HEADER_RE.test(h)) item.cost = toNumber(v);
        else if (/start\s*month/i.test(hl)) item.startMonth = cellStr(v);
        else if (/gm\s*%/i.test(hl)) item.gmPct = toPct(v);
        else if (/comment/i.test(hl)) item.comments = cellStr(v);
        else if (/description/i.test(hl) && !item.description2) item.description2 = cellStr(v);
      });
      items.push(item);
    }

    if (items.length > 0) {
      sections.push({ title, headers: headerRow, items });
    }
  }

  // Capture a small slice of raw rows for the in-app diagnostic panel
  // when nothing parses.
  const rawSample = rows.slice(0, 40).map(r => (r || []).map(cellStr));

  return {
    sheetName,
    hidden: false, // overwritten by caller
    solutionDescription,
    targetGmPct,
    sections,
    rawSample,
    totalRows: rows.length,
    headerIdxs,
  };
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toPct(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (v > 1 ? v / 100 : v) : null;
  const s = String(v).replace('%', '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export function parsePricingWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const options = [];
  for (const name of wb.SheetNames || []) {
    const m = name.match(OPTION_RE);
    if (!m) continue;
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const parsed = parseOptionSheet(sheet, name);
    parsed.optionNumber = Number(m[1]);
    parsed.hidden = sheet.Hidden === 1 || sheet.Hidden === 2;
    options.push(parsed);
  }
  options.sort((a, b) => a.optionNumber - b.optionNumber);

  if (options.length === 0) {
    const all = (wb.SheetNames || []).join(', ') || '(none)';
    throw new Error(`No "Option 1/2/3/4" sheets found in this workbook. Sheets present: ${all}.`);
  }

  return { options, sheetNames: wb.SheetNames || [] };
}

// Compute marked-up price from cost + gross-margin %. GM is the
// fraction of the *price* that is margin, so price = cost / (1 - gm).
// Returns null if either input is missing or gm >= 1.
export function priceFromCostAndGm(cost, gmPct) {
  if (cost === null || cost === undefined) return null;
  if (gmPct === null || gmPct === undefined) return null;
  if (gmPct >= 1) return null;
  return cost / (1 - gmPct);
}
