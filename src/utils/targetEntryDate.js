// The Target Accounts List's entry date for a company: the date its row went
// on the list, which the Account MRI reads as "Assigned since" (tab 1, row 13).
//
// The list is an uploaded workbook, so the column is found by its header
// ("Entry Date", "Date Entered", ...). Cells come through the upload as
// text: a typed date ("3/14/2025", "2025-03-14") or, for a cell Excel holds
// as a date, its day number ("45730").
//
// Imported with extensions so this loads under plain Node for the tests.
import { targetRowCompany } from './targetTier.js';
import { normalizeCompanyName } from './companyKey.js';

const ENTRY_HEADER = /\bentry\s*date\b|\bdate\s*(of\s*)?entry\b|\bdate\s*entered\b|\bentered\s*(on|date)\b|\bdate\s*added\b|\badded\s*(on|date)\b/i;

/** The header in `headers` that holds the entry date, or ''. */
export function targetEntryDateColumn(headers = []) {
  return (headers || []).find(h => ENTRY_HEADER.test(String(h || ''))) || '';
}

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** A cell from the list as "YYYY-MM-DD", or '' when it is not a date. */
export function parseEntryDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, +m[1], +m[2]);
  }
  // A spreadsheet day number: 1990 to 2100.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n < 32874 || n > 73051) return '';
    const dt = new Date((n - 25569) * 86400000);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t) || !/[a-z]/i.test(s)) return '';
  const dt = new Date(t);
  return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/**
 * Every company's entry date on the list, keyed by its name lower-cased:
 * Map<name, "YYYY-MM-DD">. A company on more than one row keeps its
 * earliest date, since that is when it first went on the list.
 */
export function targetEntryDates(targetAccountsData) {
  const out = new Map();
  const data = targetAccountsData;
  for (const sheetName of data?.sheetNames || []) {
    const sheet = data?.sheets?.[sheetName];
    const col = targetEntryDateColumn(sheet?.headers?.length ? sheet.headers : Object.keys(sheet?.records?.[0] || {}));
    if (!col) continue;
    for (const r of sheet.records || []) {
      const name = targetRowCompany(r);
      const date = parseEntryDate(r[col]);
      if (!name || !date) continue;
      const k = name.toLowerCase();
      if (!out.has(k) || date < out.get(k)) out.set(k, date);
    }
  }
  return out;
}

/**
 * The entry date for one company: through the Target Accounts names it is
 * mapped to (`targetNames`, as My Accounts resolves them) first, else its
 * own name. '' when the list has none.
 */
export function entryDateFor(dates, { targetNames = [], company = '' } = {}) {
  if (!dates?.size) return '';
  for (const n of targetNames || []) {
    const hit = dates.get(String(n || '').trim().toLowerCase());
    if (hit) return hit;
  }
  const own = String(company || '').trim().toLowerCase();
  if (own && dates.has(own)) return dates.get(own);
  const key = normalizeCompanyName(company);
  if (!key) return '';
  for (const [name, date] of dates) if (normalizeCompanyName(name) === key) return date;
  return '';
}
