// Parses cost data out of "Option 1/2/3/4/5" sheets in an uploaded fee
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

const OPTION_RE = /^\s*Option\s*([1-5])\b/i;
const SOLUTION_DESC_RE = /^solution\s*description$/i;
const END_ANCHOR_RE = /^\s*cost\s*summary\b/i;
// Labels in the SIA metadata block that carry # of sites / # of accounts.
// "# Sites", "# of Sites", and "Number of Sites" are all accepted; the
// value can sit in any cell to the right of the label on the same row.
const SITES_LABEL_RE = /^\s*(#\s*(of\s+)?sites?|number\s*of\s*sites?|sites?\s*count|total\s*sites?|sites?)\s*[:-]?\s*$/i;
const ACCOUNTS_LABEL_RE = /^\s*(#\s*(of\s+)?accounts?|number\s*of\s*accounts?|accounts?\s*count|total\s*accounts?|accounts?)\s*[:-]?\s*$/i;
// The SIA's own margin: the "Target GM %" setup row, and the "Use Target"
// flag beside it that says whether the workbook priced off that target or
// off each line's individual GM. Both can sit in the metadata block at the
// top of the sheet or further down beside the Cost Summary, depending on
// the template vintage, so they're scanned for across the whole sheet.
const TARGET_GM_LABEL_RE = /^\s*(target\s*gm\s*%?|recommended\s*gm\s*%?|gm\s*%\s*target)\s*[:-]?\s*$/i;
const USE_TARGET_LABEL_RE = /^\s*use\s*target\s*(gm\s*%?)?\s*[:-]?\s*$/i;
// Per the SIA template, the first 18 rows are sheet metadata (Date,
// Salesperson, Currency Conversion, Solution description, Target
// GM%, Use Target). The line-item tables always begin below row 18.
const SKIP_LEADING_ROWS = 18;

// Header-cell matchers for the 5 columns we display.
const COL_MATCHERS = {
  description: /^line\s*item$|alternative\s*fee\s*structure|^description$/i,
  type: /^type$/i,
  cts: /^cts$|cost\s*to\s*serve/i,
  startMonth: /^start\s*month$|fee\s*start\s*month/i,
  comments: /^comment/i,
};
// GM% is read separately so per-row sheet GM% can still feed the
// markup math even though the column isn't displayed.
const GM_MATCHER = /gm\s*%|individual\s*gm/i;

function cellStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function rowIsBlank(row) {
  if (!Array.isArray(row)) return true;
  return row.every(c => cellStr(c) === '');
}

// A header row is one whose cells include both a "Type" header and
// a "Cost to Serve" / "CTS" header. The section title is then read
// from column A of that same row (e.g. "SB Services (CTS)").
function isHeaderRow(row) {
  if (!Array.isArray(row)) return false;
  let hasType = false, hasCts = false;
  for (const c of row) {
    const s = cellStr(c);
    if (!s) continue;
    if (/^type$/i.test(s)) hasType = true;
    if (/^cts$|cost\s*to\s*serve/i.test(s)) hasCts = true;
  }
  return hasType && hasCts;
}

// The Alternative Fee Structure table has its own header row shape —
// no CTS column, but Type / Fee / Unit / Unit Count / Fee Start Month
// instead. We accept two flavors: the strict SIA template ("Alternative
// Fee Structure/Schedule" label + Fee + Unit/Unit Count), and a looser
// pattern (Type + Fee + Unit or Unit Count, no CTS) so workbooks that
// don't repeat the literal label on the header row still parse.
function isAltFeeHeaderRow(row) {
  if (!Array.isArray(row)) return false;
  let hasAltLabel = false, hasType = false, hasFeeCol = false, hasUnitCol = false, hasCts = false;
  for (const c of row) {
    const s = cellStr(c);
    if (!s) continue;
    if (/alternative\s*fee\s*structure/i.test(s)) hasAltLabel = true;
    if (/^type$/i.test(s)) hasType = true;
    if (/^fee$/i.test(s)) hasFeeCol = true;
    if (/^unit$/i.test(s) || /unit\s*count/i.test(s)) hasUnitCol = true;
    if (/^cts$|cost\s*to\s*serve/i.test(s)) hasCts = true;
  }
  if (hasCts) return false;
  if (hasAltLabel && hasFeeCol) return true;
  return hasType && hasFeeCol && hasUnitCol;
}

function classifyColumns(headerRow) {
  const map = {};
  headerRow.forEach((cell, i) => {
    const s = cellStr(cell);
    if (!s) return;
    if (map.gmPct === undefined && GM_MATCHER.test(s)) map.gmPct = i;
    for (const [field, re] of Object.entries(COL_MATCHERS)) {
      if (map[field] !== undefined) continue;
      if (re.test(s)) { map[field] = i; break; }
    }
  });
  if (map.description === undefined) map.description = 0;
  return map;
}

// Column map for an alt-fee table. Matches the SIA template's six
// columns; falls back to sensible defaults so a partial header still
// produces usable rows.
function classifyAltFeeColumns(headerRow) {
  const map = {};
  headerRow.forEach((cell, i) => {
    const s = cellStr(cell);
    if (!s) return;
    if (map.altItem === undefined && /alternative\s*fee\s*structure/i.test(s)) map.altItem = i;
    if (map.type === undefined && /^type$/i.test(s)) map.type = i;
    if (map.fee === undefined && /^fee$/i.test(s)) map.fee = i;
    if (map.unitCount === undefined && /unit\s*count/i.test(s)) map.unitCount = i;
    if (map.unit === undefined && /^unit$/i.test(s)) map.unit = i;
    if (map.startMonth === undefined && /fee\s*start\s*month|^start\s*month$/i.test(s)) map.startMonth = i;
  });
  if (map.altItem === undefined) map.altItem = 0;
  return map;
}

// Some workbooks (especially sheets that are hidden) ship with no
// `!ref` set or a `!ref` that doesn't actually cover the data. Without
// a valid range, sheet_to_json returns []. Recompute the range from
// every A1-style cell key on the sheet and patch it in before reading.
function ensureSheetRange(sheet) {
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const addr = XLSX.utils.decode_cell(key);
    if (!addr || !Number.isFinite(addr.r) || !Number.isFinite(addr.c)) continue;
    if (addr.r < minR) minR = addr.r;
    if (addr.r > maxR) maxR = addr.r;
    if (addr.c < minC) minC = addr.c;
    if (addr.c > maxC) maxC = addr.c;
  }
  if (maxR < 0) return; // truly empty
  const computed = XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
  // Always overwrite — a too-small `!ref` would clip our read.
  sheet['!ref'] = computed;
}

function parseOptionSheet(sheet, sheetName) {
  ensureSheetRange(sheet);
  const cellCount = Object.keys(sheet).filter(k => !k.startsWith('!')).length;
  const refUsed = sheet['!ref'] || '';
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: true,
  });

  // Skip a fixed block of leading metadata rows; locate the Cost
  // Summary end anchor below it.
  const startIdx = Math.min(SKIP_LEADING_ROWS, rows.length);
  let endIdx = -1;
  for (let i = startIdx; i < rows.length; i++) {
    const a = cellStr((rows[i] || [])[0]);
    if (!a) continue;
    if (END_ANCHOR_RE.test(a)) { endIdx = i; break; }
  }

  // # of Sites / # of Accounts live in the SIA metadata block above
  // the line-item tables. Scan rows 0..startIdx for a label match and
  // pull the first numeric cell to the right of it on the same row.
  let siteCount = null;
  let accountCount = null;
  for (let i = 0; i < Math.min(rows.length, startIdx + 4); i++) {
    const row = rows[i] || [];
    for (let c = 0; c < row.length; c++) {
      const label = cellStr(row[c]);
      if (!label) continue;
      const isSiteLabel = siteCount === null && SITES_LABEL_RE.test(label);
      const isAccountLabel = accountCount === null && ACCOUNTS_LABEL_RE.test(label);
      if (!isSiteLabel && !isAccountLabel) continue;
      let value = null;
      for (let j = c + 1; j < row.length; j++) {
        const n = toNumber(row[j]);
        if (n !== null && Number.isFinite(n) && n > 0) { value = n; break; }
      }
      if (value === null) continue;
      if (isSiteLabel) siteCount = value;
      else accountCount = value;
    }
  }

  // Target GM % / Use Target — the SIA's own margin, so the Pricing page can
  // offer it instead of the user typing one. Scanned across the whole sheet
  // (see the label regexes above); the value is the first usable cell to the
  // right of the label on the same row.
  let targetGmPct = null;
  let useTargetGm = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    for (let c = 0; c < row.length; c++) {
      const label = cellStr(row[c]);
      if (!label) continue;
      if (targetGmPct === null && TARGET_GM_LABEL_RE.test(label)) {
        for (let j = c + 1; j < row.length; j++) {
          const g = toGmFraction(row[j]);
          if (g !== null) { targetGmPct = g; break; }
        }
      } else if (useTargetGm === null && USE_TARGET_LABEL_RE.test(label)) {
        for (let j = c + 1; j < row.length; j++) {
          const f = toFlag(row[j]);
          if (f !== null) { useTargetGm = f; break; }
        }
      }
    }
    if (targetGmPct !== null && useTargetGm !== null) break;
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
  const altFees = [];
  {
    const stop = endIdx === -1 ? rows.length : endIdx;
    // Find every header row. CTS section headers must sit inside the
    // bounded Delivery-Team-Inputs → Cost-Summary range; the
    // Alternative Fee table is allowed anywhere on the sheet — some
    // SIAs put it above the metadata block (e.g. a "Fee Development"
    // layout at the very top) and others park it below Cost Summary,
    // so we scan the full sheet for alt-fee headers. Both kinds share
    // the same "row index → next-row-index" segmentation so each
    // block's items don't bleed into the next.
    const headerIdxs = [];
    const altFeeHeaderIdxs = new Set();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      if (isAltFeeHeaderRow(row)) {
        headerIdxs.push(i);
        altFeeHeaderIdxs.add(i);
      } else if (i >= startIdx && i < stop && isHeaderRow(row)) {
        headerIdxs.push(i);
      }
    }

    for (let hi = 0; hi < headerIdxs.length; hi++) {
      const idx = headerIdxs[hi];
      // Default the segment end to the end of the sheet — alt-fee
      // tables sometimes live below Cost Summary, and `stop` would
      // truncate the scan to zero rows in that case. CTS sections
      // cap themselves at `stop` below.
      const nextHeaderIdx = headerIdxs[hi + 1] ?? rows.length;
      if (altFeeHeaderIdxs.has(idx)) {
        // Alt-fee table — collect into altFees[] and continue. We
        // skip the rest of the CTS-section logic for this block since
        // it has no CTS column.
        const headerRow = (rows[idx] || []).map(cellStr);
        const cols = classifyAltFeeColumns(headerRow);
        for (let r = idx + 1; r < nextHeaderIdx; r++) {
          const row = rows[r] || [];
          // The first truly-blank row ends the alt-fee table —
          // anything beyond it belongs to whatever section comes
          // next on the sheet (Fee Structure Variance, term/TCV
          // breakdown, etc.) and must not be imported as alt-fee
          // rows.
          if (rowIsBlank(row)) break;
          const altItem = cellStr(row[cols.altItem]);
          if (!altItem) continue;
          if (/^enter\s+.+\s+here$/i.test(altItem)) continue;
          // Stop the moment we hit a label that signals the table
          // is over (defensive — usually the next header / blank row
          // catches it first).
          if (END_ANCHOR_RE.test(altItem)) break;
          const typeStr = cols.type !== undefined ? cellStr(row[cols.type]) : '';
          if (/^(description|type|comments?|fee|unit|cts|cost\s*to\s*serve|gm\s*%|individual\s*gm|start\s*month)$/i.test(typeStr)) continue;
          // Real alt-fee rows always declare a Type ("Setup", "One
          // Time", "Recurring (monthly)", …). A row with text in
          // column 0 but no Type is a section title that slipped in
          // below the table — drop it.
          if (!typeStr) continue;
          const ucRaw = cols.unitCount !== undefined ? toNumber(row[cols.unitCount]) : null;
          const smRaw = cols.startMonth !== undefined ? toNumber(row[cols.startMonth]) : null;
          altFees.push({
            altItem,
            type: typeStr,
            fee: cols.fee !== undefined ? toNumber(row[cols.fee]) : null,
            unit: cols.unit !== undefined ? cellStr(row[cols.unit]) : '',
            // Mirror altFeeStarter() defaults so an imported blank
            // matches the in-app placeholder values. startMonth stays
            // null when the workbook doesn't supply one so the alt-fee
            // table can auto-derive it from linked CTS rows.
            unitCount: ucRaw == null ? 1 : ucRaw,
            startMonth: smRaw == null ? null : smRaw,
          });
        }
        continue;
      }
      const headerRow = (rows[idx] || []).map(cellStr);
      const cols = classifyColumns(headerRow);
      // CTS sections never read past Cost Summary, even if the next
      // boundary in `headerIdxs` is an alt-fee header that lives
      // below it.
      const ctsSectionEnd = Math.min(nextHeaderIdx, stop);

      // Section title: nearest non-blank single-label row above the
      // header (e.g. "SB Services (CTS w/recommended GM%)"), bounded
      // by the previous header so we don't reach across sections.
      let title = '';
      const lowBound = (headerIdxs[hi - 1] ?? (startIdx - 1)) + 1;
      for (let j = idx - 1; j >= lowBound; j--) {
        const r = rows[j] || [];
        if (rowIsBlank(r)) continue;
        const a = cellStr(r[0]);
        const others = r.slice(1).filter(c => cellStr(c)).length;
        // Skip placeholder lines so they don't become section titles.
        if (/^enter\s+.+\s+here$/i.test(a)) continue;
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
      for (let r = idx + 1; r < ctsSectionEnd; r++) {
        const row = rows[r] || [];
        if (rowIsBlank(row)) continue;
        const desc = cellStr(row[cols.description ?? 0]);
        if (!desc) continue;
        // Skip placeholder rows ("Enter department here", "Enter
        // service here", etc.).
        if (/^enter\s+.+\s+here$/i.test(desc)) continue;
        if (/enter\s+department\s+here/i.test(desc)) continue;
        // Don't consume the end anchor, the GM%/Use Target setup
        // rows, or another section title.
        if (END_ANCHOR_RE.test(desc)) break;
        if (/^(target\s*gm\s*%|use\s*target|delivery\s*team\s*inputs|solution\s*description|are\s+all\s+values)/i.test(desc)) continue;
        // Skip rows whose Type cell is blank — those are unfilled
        // template stubs that show up between real line items.
        if (cols.type !== undefined && !cellStr(row[cols.type])) continue;
        // Skip rows whose Type cell is a header label (e.g. the
        // "Services (per event or shared savings) | Description" row
        // that sits between sub-tables — its col B reads "Description"
        // which clearly isn't a real Type).
        if (cols.type !== undefined) {
          const tval = cellStr(row[cols.type]);
          if (/^(description|type|comments?|fee|unit|cts|cost\s*to\s*serve|gm\s*%|individual\s*gm|start\s*month)$/i.test(tval)) continue;
        }

        const item = {
          id: `${sheetName}::${title}::${items.length}::${desc.slice(0, 40)}`,
          raw: row.slice(),
          description: desc,
          type: cols.type !== undefined ? cellStr(row[cols.type]) : '',
          cts: cols.cts !== undefined ? toNumber(row[cols.cts]) : null,
          startMonth: cols.startMonth !== undefined ? cellStr(row[cols.startMonth]) : '',
          comments: cols.comments !== undefined ? cellStr(row[cols.comments]) : '',
          gmPct: cols.gmPct !== undefined ? toPct(row[cols.gmPct]) : null,
        };
        items.push(item);
      }

      if (items.length > 0) {
        sections.push({ title, headers: headerRow, cols, items });
      }
    }
  }

  // Diagnostic sample so the in-app fallback panel can show the user
  // what was actually read when nothing parses. Trim to the bounded
  // range when the anchors were found so we don't dump the
  // sheet-level metadata (Date / Salesperson / Annual kWh / ...).
  const sampleStart = startIdx >= 0 ? startIdx : 0;
  const sampleEnd = endIdx >= 0 ? Math.min(rows.length, endIdx + 1) : Math.min(rows.length, sampleStart + 80);
  const rawSample = rows.slice(sampleStart, sampleEnd).map(r => (r || []).map(cellStr));
  const rawSampleOffset = sampleStart;

  return {
    sheetName,
    hidden: false, // overwritten by caller
    solutionDescription,
    siteCount,
    accountCount,
    targetGmPct,
    useTargetGm,
    sections,
    altFees,
    rawSample,
    rawSampleOffset,
    totalRows: rows.length,
    startIdx,
    endIdx,
    cellCount,
    refUsed,
  };
}

// A GM cell as a 0..1 fraction. Excel hands back 0.35 for a cell formatted
// as 35%, but a hand-typed "35" or "35%" arrives as 35 / "35%" — so anything
// above 1 is read as whole percent. 0 (and anything that doesn't parse) is
// treated as "not set" rather than a 0% target, since that's what an
// untouched template cell looks like.
function toGmFraction(v) {
  if (v === null || v === undefined || v === '') return null;
  let n = typeof v === 'number' ? v : toNumber(String(v).replace(/%/g, ''));
  if (n === null || !Number.isFinite(n)) return null;
  if (n > 1) n /= 100;
  if (!(n > 0) || n >= 1) return null;
  return n;
}

// "Use Target" as a boolean; null when the cell says nothing recognisable.
function toFlag(v) {
  const s = cellStr(v).toLowerCase();
  if (!s) return null;
  if (/^(y|yes|true|x|1)$/.test(s)) return true;
  if (/^(n|no|false|0)$/.test(s)) return false;
  return null;
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
    throw new Error(`No "Option 1/2/3/4/5" sheets found in this workbook. Sheets present: ${all}.`);
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
