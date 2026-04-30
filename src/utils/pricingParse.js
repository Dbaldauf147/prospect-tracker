// Parses cost data out of "Option 1/2/3/4" sheets in an uploaded fee
// workbook. The data we care about is bounded between two anchor
// rows on each sheet:
//
//   start: "Delivery Team Inputs"
//   end:   "Cost Summary"
//
// Inside that range, line items live in one or more sub-tables whose
// header rows match the columns:
//
//   Alternative Fee Structure/Schedule | Type | Fee | Unit |
//   Unit Count (# of Sites or Accounts) | Fee Start Month
//
// Each detected header row starts a new section; the rows below it
// (until the next header or the Cost Summary anchor) are line items
// keyed by the value in the first column.
//
// Hidden sheets are read just like visible ones — XLSX preserves
// `Sheet.Hidden` (1 = hidden, 2 = very hidden) on the workbook, which
// we surface but don't filter on.

import * as XLSX from 'xlsx';

const OPTION_RE = /^\s*Option\s*([1-4])\b/i;
const SOLUTION_DESC_RE = /^solution\s*description$/i;
const START_ANCHOR_RE = /^\s*delivery\s*team\s*inputs\b/i;
const END_ANCHOR_RE = /^\s*cost\s*summary\b/i;

// Header-cell matchers for the columns we recognize.
const COL_MATCHERS = {
  description: /alternative\s*fee\s*structure|schedule|service|description/i,
  type: /^type$/i,
  fee: /^fee$|cost\s*to\s*serve/i,
  unit: /^unit$/i,
  unitCount: /unit\s*count|#\s*of\s*sites|#\s*of\s*accounts/i,
  startMonth: /(fee\s*)?start\s*month/i,
  gmPct: /gm\s*%|individual\s*gm/i,
  comments: /^comment/i,
};

function cellStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function rowIsBlank(row) {
  if (!Array.isArray(row)) return true;
  return row.every(c => cellStr(c) === '');
}

// A header row is one whose cells include either an "Alternative Fee
// Structure/Schedule" label OR the trio Fee + Unit + Type — both
// shapes show up across different fee templates.
function isHeaderRow(row) {
  if (!Array.isArray(row)) return false;
  let altFee = false, hasFee = false, hasUnit = false, hasType = false;
  for (const c of row) {
    const s = cellStr(c);
    if (!s) continue;
    if (/alternative\s*fee\s*structure/i.test(s)) altFee = true;
    if (/^fee$/i.test(s) || /cost\s*to\s*serve/i.test(s)) hasFee = true;
    if (/^unit$/i.test(s)) hasUnit = true;
    if (/^type$/i.test(s)) hasType = true;
  }
  return altFee || (hasFee && hasUnit && hasType);
}

function classifyColumns(headerRow) {
  const map = {};
  headerRow.forEach((cell, i) => {
    const s = cellStr(cell);
    if (!s) return;
    for (const [field, re] of Object.entries(COL_MATCHERS)) {
      if (map[field] !== undefined) continue;
      if (re.test(s)) { map[field] = i; break; }
    }
  });
  // Fall back: if no description column was tagged, treat col 0 as
  // the description column.
  if (map.description === undefined) map.description = 0;
  return map;
}

function parseOptionSheet(sheet, sheetName) {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: true,
  });

  // Locate the anchors.
  let startIdx = -1, endIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const a = cellStr((rows[i] || [])[0]);
    if (!a) continue;
    if (startIdx === -1 && START_ANCHOR_RE.test(a)) startIdx = i;
    else if (startIdx !== -1 && endIdx === -1 && END_ANCHOR_RE.test(a)) {
      endIdx = i;
      break;
    }
  }

  // Solution description — captured from anywhere on the sheet, even
  // outside the anchor range, since it's typically up at the top.
  let solutionDescription = '';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const a = cellStr(row[0]);
    if (!a) continue;
    if (SOLUTION_DESC_RE.test(a)) {
      const here = cellStr(row[1]);
      if (here) {
        solutionDescription = here;
      } else {
        for (let j = i + 1; j < Math.min(rows.length, i + 4); j++) {
          const next = rows[j] || [];
          const nv = cellStr(next[0]) || cellStr(next[1]);
          if (nv) { solutionDescription = nv; break; }
        }
      }
      break;
    }
  }

  const sections = [];
  if (startIdx !== -1) {
    const stop = endIdx === -1 ? rows.length : endIdx;
    // Find every header row inside the bounded range.
    const headerIdxs = [];
    for (let i = startIdx + 1; i < stop; i++) {
      if (isHeaderRow(rows[i] || [])) headerIdxs.push(i);
    }

    for (let hi = 0; hi < headerIdxs.length; hi++) {
      const idx = headerIdxs[hi];
      const headerRow = (rows[idx] || []).map(cellStr);
      const cols = classifyColumns(headerRow);
      const nextHeaderIdx = headerIdxs[hi + 1] ?? stop;

      // Section title: nearest non-blank single-label row above the
      // header (e.g. "SB Services (CTS w/recommended GM%)"), bounded
      // by the previous header so we don't reach across sections.
      let title = '';
      const lowBound = (headerIdxs[hi - 1] ?? startIdx) + 1;
      for (let j = idx - 1; j >= lowBound; j--) {
        const r = rows[j] || [];
        if (rowIsBlank(r)) continue;
        const a = cellStr(r[0]);
        const others = r.slice(1).filter(c => cellStr(c)).length;
        // A section-title row has text in col 0 and is otherwise empty.
        if (a && others === 0) { title = a; break; }
        // Stop walking up once we hit something with multiple cells
        // populated (likely another sub-table's data).
        if (others >= 1) break;
      }
      if (!title) {
        title = cellStr(headerRow[cols.description]) || `Section ${hi + 1}`;
      }

      const items = [];
      for (let r = idx + 1; r < nextHeaderIdx; r++) {
        const row = rows[r] || [];
        if (rowIsBlank(row)) continue;
        const desc = cellStr(row[cols.description ?? 0]);
        if (!desc) continue;
        // Skip placeholder "Enter X here" rows.
        if (/^enter\s+.+\s+here$/i.test(desc)) continue;
        // Don't consume the end anchor or another section title.
        if (END_ANCHOR_RE.test(desc)) break;

        const item = {
          id: `${sheetName}::${title}::${items.length}::${desc.slice(0, 40)}`,
          raw: row.slice(),
          description: desc,
          type: cols.type !== undefined ? cellStr(row[cols.type]) : '',
          unit: cols.unit !== undefined ? cellStr(row[cols.unit]) : '',
          unitCount: cols.unitCount !== undefined ? toNumber(row[cols.unitCount]) : null,
          startMonth: cols.startMonth !== undefined ? cellStr(row[cols.startMonth]) : '',
          gmPct: cols.gmPct !== undefined ? toPct(row[cols.gmPct]) : null,
          comments: cols.comments !== undefined ? cellStr(row[cols.comments]) : '',
          fee: cols.fee !== undefined ? toNumber(row[cols.fee]) : null,
        };
        items.push(item);
      }

      if (items.length > 0) {
        sections.push({ title, headers: headerRow, cols, items });
      }
    }
  }

  // Diagnostic sample so the in-app fallback panel can show the user
  // what was actually read when nothing parses.
  const rawSample = rows.slice(0, 60).map(r => (r || []).map(cellStr));

  return {
    sheetName,
    hidden: false, // overwritten by caller
    solutionDescription,
    sections,
    rawSample,
    totalRows: rows.length,
    startIdx,
    endIdx,
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

// Marked-up unit price from cost + gross-margin %. GM is the fraction
// of the *price* that is margin, so price = cost / (1 - gm).
export function priceFromCostAndGm(cost, gmPct) {
  if (cost === null || cost === undefined) return null;
  if (gmPct === null || gmPct === undefined) return null;
  if (gmPct >= 1) return null;
  return cost / (1 - gmPct);
}
