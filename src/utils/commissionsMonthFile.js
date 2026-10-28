// Reading a commissions Excel file dropped onto one month of the
// Commissions > Monthly subtab. The file is turned into the same
// { headers, rows } grid the paste popup builds from clipboard text, so the
// dropped file goes through the same column mapping and the same merge
// (planCommissionsPaste) as a paste.
//
// What dropping onto a MONTH adds: a monthly commission statement usually
// has one generic "Commission" / "Revenue" column rather than a column per
// month, so those generic headers map onto the month the file was dropped
// on ("Commission" -> "March", "Revenue" -> "March Revenue"). Headers that
// already name a month keep mapping to that month.

import { COMMISSION_MONTH_NAMES } from './commissionsStore.js';

// Canonical destination columns. Order mirrors the table layout: identity
// columns, monthly revenue, the FY total, then the monthly commission
// amounts. Year-agnostic, so "1/1/2026 Revenue" lands in "January Revenue".
function buildCanonical() {
  const cols = ['Name', 'Account Name', 'BFO Name', 'Project Name', 'Comm Start Date', 'Comm End Date', '%'];
  for (const m of COMMISSION_MONTH_NAMES) cols.push(`${m} Revenue`);
  cols.push('FY Revenue');
  for (const m of COMMISSION_MONTH_NAMES) cols.push(m);
  return cols;
}

export const COMMISSIONS_CANONICAL = buildCanonical();

// Cheap normalizer for header-vs-header comparisons. Lowercases, drops
// whitespace, "." and "$".
function normHeader(s) {
  return String(s || '').toLowerCase().replace(/[\s.$]/g, '');
}

const NORM_CANONICAL = COMMISSIONS_CANONICAL.map(c => ({ c, n: normHeader(c) }));

const MONTH_NAMES_LOWER = COMMISSION_MONTH_NAMES.map(m => m.toLowerCase());

// Month index behind a date-like header: "1/1/2026", "1/1/26", "Jan-26",
// "Jan 2026", "January 2026", "Sept 2026". -1 when it isn't one. A bare
// month name ("January") is left to the canonical lookup.
function monthFromDateHeader(s) {
  const slash = /^(\d{1,2})\/\d{1,2}\/\d{2,4}$/.exec(s);
  if (slash) {
    const mi = Number(slash[1]);
    return mi >= 1 && mi <= 12 ? mi - 1 : -1;
  }
  const named = /^([a-z]+)[\s\-/']+(\d{2}|\d{4})$/i.exec(s);
  if (named) {
    // The word has to be a month name or a prefix of one ("Jan", "Sept").
    const word = named[1].toLowerCase();
    if (word.length < 3) return -1;
    return MONTH_NAMES_LOWER.findIndex(full => full.startsWith(word));
  }
  return -1;
}

/**
 * Map one source header onto a canonical destination column, or '' to skip.
 * `monthIdx` (0-11) is the month the file was dropped on; without it only
 * headers that name their destination outright are mapped, which is how the
 * paste popup has always behaved.
 */
export function autoMapCommissionHeader(srcHeader, monthIdx = null) {
  const cleaned = String(srcHeader || '').trim().replace(/\.+$/, '');
  if (!cleaned) return '';

  // FY{year} Revenue -> FY Revenue (year stripped).
  if (/^FY\s?\d{2,4}\s+Revenue$/i.test(cleaned)) return 'FY Revenue';

  // A date-like month header, with or without a trailing " Revenue".
  const revMatch = /^(.*\S)\s+Revenue$/i.exec(cleaned);
  if (revMatch) {
    const mi = monthFromDateHeader(revMatch[1]);
    if (mi >= 0) return `${COMMISSION_MONTH_NAMES[mi]} Revenue`;
  }
  const mi = monthFromDateHeader(cleaned);
  if (mi >= 0) return COMMISSION_MONTH_NAMES[mi];

  const n = normHeader(cleaned);
  const hit = NORM_CANONICAL.find(x => x.n === n);
  if (hit) return hit.c;

  // Everything below is only for a file dropped onto a month.
  if (monthIdx == null || monthIdx < 0 || monthIdx > 11) return '';
  const month = COMMISSION_MONTH_NAMES[monthIdx];
  const lower = cleaned.toLowerCase();

  if (/^(project|project name|opportunity|opportunity name|opp name|deal|deal name)$/.test(lower)) return 'Project Name';
  if (/^(account|client|client name|customer|customer name|company)$/.test(lower)) return 'Account Name';
  if (/^(bfo|bfo opportunity name|bfo opp name)$/.test(lower)) return 'BFO Name';
  if (/^(rep|rep name|salesperson|sales rep|employee|owner)$/.test(lower)) return 'Name';
  if (/(start date|comm start)/.test(lower)) return 'Comm Start Date';
  if (/(end date|comm end)/.test(lower)) return 'Comm End Date';
  // A rate column, before the "commission" test below swallows "Commission %".
  if (/%|percent|\brate\b/.test(lower)) return '%';
  if (/\bfy\b|fiscal|annual|ytd|total revenue/.test(lower)) return '';
  if (/revenue|\brev\b|billed|billing|invoiced|sales/.test(lower)) return `${month} Revenue`;
  if (/commission|\bcomm\b|payout|paid|earned|amount/.test(lower)) return month;
  return '';
}

// Is this a row a header could be on? At least two filled cells.
const filledCount = (row) => (row || []).filter(c => String(c ?? '').trim() !== '').length;

/**
 * Turn a sheet read as an array of arrays (XLSX sheet_to_json header:1) into
 * { headers, rows }. Statements often open with a title block, so the header
 * row is the first of the top 20 rows where most filled cells map to a
 * destination; failing that, the first row with two or more filled cells.
 */
export function gridFromSheetRows(aoa, monthIdx = null) {
  const all = (aoa || []).map(r => (Array.isArray(r) ? r : []));
  let headerAt = -1;
  let best = 0;
  for (let i = 0; i < Math.min(all.length, 20); i++) {
    const filled = filledCount(all[i]);
    if (filled < 2) continue;
    const mapped = all[i].filter(c => autoMapCommissionHeader(c, monthIdx)).length;
    if (mapped >= 2 && mapped > best) { best = mapped; headerAt = i; }
  }
  if (headerAt === -1) headerAt = all.findIndex(r => filledCount(r) >= 2);
  if (headerAt === -1) return { headers: [], rows: [] };
  const headers = all[headerAt].map(h => String(h ?? '').trim());
  const rows = all.slice(headerAt + 1)
    .filter(r => filledCount(r) > 0)
    .map(r => headers.map((_, i) => {
      const v = r[i];
      return v == null ? '' : v;
    }));
  return { headers, rows };
}

// The file types the Monthly drop zones read.
export function isCommissionsFileName(name) {
  return /\.(xlsx|xls|xlsm|csv)$/i.test(String(name || ''));
}

/**
 * Read a dropped File into { headers, rows, sheetName }. Only the first sheet
 * is read. Throws with a message fit for the page when nothing usable is in it.
 */
export async function readCommissionsFile(file, monthIdx = null) {
  const buf = await file.arrayBuffer();
  // Pulled in on use: the spreadsheet library is large and this page only
  // needs it when a file is dropped.
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : null;
  if (!sheet) throw new Error(`${file.name} has no sheets.`);
  // Numbers stay numbers; dates and everything else come through as the text
  // Excel shows, which the date and currency parsers already read.
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, rawNumbers: true, defval: '', blankrows: false });
  const grid = gridFromSheetRows(aoa, monthIdx);
  if (grid.headers.length === 0 || grid.rows.length === 0) {
    throw new Error(`No rows found in ${file.name}: the first sheet needs a header row and at least one data row.`);
  }
  return { ...grid, sheetName };
}

/**
 * Per-month totals across the roster: commission $, revenue $, and how many
 * rows have a commission that month. Ignored rows are left out, as they are
 * on the YOY page.
 */
export function commissionMonthlyTotals(rows, asNumber) {
  const out = COMMISSION_MONTH_NAMES.map(month => ({ month, commission: 0, revenue: 0, paidRows: 0, rows: 0 }));
  for (const row of rows || []) {
    if (!row || row.__ignored) continue;
    COMMISSION_MONTH_NAMES.forEach((m, i) => {
      const c = asNumber(row[m]);
      const r = asNumber(row[`${m} Revenue`]);
      if (c != null) out[i].commission += c;
      if (r != null) out[i].revenue += r;
      if (c != null && c !== 0) out[i].paidRows++;
      if ((c != null && c !== 0) || (r != null && r !== 0)) out[i].rows++;
    });
  }
  return out;
}
