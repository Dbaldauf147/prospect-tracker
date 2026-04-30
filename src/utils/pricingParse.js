// Parses cost data out of "Option 1/2/3/4" sheets in an uploaded fee
// workbook. Each Option sheet has a free-text "Solution description"
// up top and one or more sub-tables of line items underneath. Tables
// are detected heuristically: any row whose first cell is a non-empty
// string and whose later cells include the column header "Cost to
// Serve" (and usually "Type") is treated as the header of a new
// sub-table. Rows below that header are line items, until a blank row
// or another header row is hit.
//
// Hidden sheets are read just like visible ones — XLSX preserves
// `Sheet.Hidden` (1 = hidden, 2 = very hidden) on the workbook, which
// we surface but don't filter on.

import * as XLSX from 'xlsx';

const OPTION_RE = /^\s*Option\s*([1-4])\b/i;
const COST_HEADER_RE = /^cost\s*to\s*serve$/i;
const SOLUTION_DESC_RE = /^solution\s*description$/i;

function cellStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function rowIsBlank(row) {
  if (!Array.isArray(row)) return true;
  return row.every(c => cellStr(c) === '');
}

function findCostColumn(row) {
  for (let i = 0; i < row.length; i++) {
    if (COST_HEADER_RE.test(cellStr(row[i]))) return i;
  }
  return -1;
}

// A header row has a label in col 0, a "Cost to Serve" column
// somewhere, and at least one other labeled column (Type, GM%,
// Description, etc.). The screenshot also shows section headers like
// "Services (per event or shared savings)" with only "Description"
// — we accept those too (cost column may be -1 then).
function classifyRow(row) {
  const a = cellStr(row[0]);
  if (!a) return { kind: 'data' };
  const costIdx = findCostColumn(row);
  // Count non-empty cells past col 0 — a header row typically has
  // multiple labeled columns.
  let labelCount = 0;
  for (let i = 1; i < row.length; i++) {
    if (cellStr(row[i])) labelCount++;
  }
  if (costIdx >= 0 && labelCount >= 1) return { kind: 'header', costIdx };
  // Description-only sub-table header (e.g. "Services (per event or
  // shared savings)" with a single "Description" column).
  if (labelCount >= 1 && row.slice(1).some(c => /description/i.test(cellStr(c)))) {
    return { kind: 'header', costIdx: -1 };
  }
  return { kind: 'data' };
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
  const sections = []; // { title, headers, costIdx, items: [{ raw, description, type, cost, gmPct, comments, startMonth }] }
  let current = null;
  let pendingTitle = '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const a = cellStr(row[0]);

    if (rowIsBlank(row)) {
      // Blank row ends the current section; the next labeled row will
      // either be a new section title or a new header.
      current = null;
      continue;
    }

    // "Solution description" / value pair — value is on this row or
    // the next.
    if (SOLUTION_DESC_RE.test(a)) {
      const here = cellStr(row[1]);
      if (here) {
        solutionDescription = here;
      } else {
        const next = rows[i + 1] || [];
        solutionDescription = cellStr(next[0]) || cellStr(next[1]);
      }
      current = null;
      continue;
    }

    // "Target GM% for SB Services" / value pair.
    if (/target\s*gm\s*%/i.test(a)) {
      const v = row.slice(1).map(cellStr).find(Boolean);
      if (v) {
        const n = Number(String(v).replace('%', '').trim());
        if (!Number.isNaN(n)) targetGmPct = n > 1 ? n / 100 : n;
      }
      current = null;
      continue;
    }

    const cls = classifyRow(row);
    if (cls.kind === 'header') {
      // Promote a single-cell labeled row from the previous iteration
      // to the section title (e.g. "Delivery Team Inputs").
      const headers = row.map(cellStr);
      current = {
        title: pendingTitle || a,
        headers,
        costIdx: cls.costIdx,
        items: [],
      };
      sections.push(current);
      pendingTitle = '';
      continue;
    }

    // A row with a single labeled cell in col A and nothing else is
    // probably a section title for whatever header row comes next
    // (e.g. "Delivery Team Inputs").
    const labelCount = row.slice(1).filter(c => cellStr(c)).length;
    if (a && labelCount === 0) {
      pendingTitle = a;
      continue;
    }

    // Otherwise it's a data row inside the current section.
    if (current && a) {
      const item = {
        id: `${sheetName}::${current.title}::${current.items.length}::${a.slice(0, 40)}`,
        raw: row.slice(),
        description: a,
      };
      // Map known columns by header name.
      current.headers.forEach((h, idx) => {
        if (idx === 0) return;
        const hl = h.toLowerCase();
        const v = row[idx];
        if (/^type$/.test(hl)) item.type = cellStr(v);
        else if (COST_HEADER_RE.test(h)) item.cost = toNumber(v);
        else if (/start\s*month/i.test(hl)) item.startMonth = cellStr(v);
        else if (/gm\s*%/i.test(hl)) item.gmPct = toPct(v);
        else if (/comment/i.test(hl)) item.comments = cellStr(v);
        else if (/description/i.test(hl) && !item.description2) item.description2 = cellStr(v);
      });
      current.items.push(item);
    }
  }

  // Drop sections that have zero data items — usually section-title
  // rows we mis-detected.
  const cleaned = sections.filter(s => s.items.length > 0);

  return {
    sheetName,
    hidden: false, // overwritten by caller
    solutionDescription,
    targetGmPct,
    sections: cleaned,
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
