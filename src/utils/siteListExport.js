// Take a company's saved Site List out of the popup as a file.
//
// The list is whatever table the company came in on, so the popup can show
// it but could never hand it back: the only ways out were the raw source
// file (which the paste path never has) or re-typing what is on screen.
// What somebody actually wants out of here is usually a SUBSET - the sites
// and the addresses for a walk plan, the sites and the divisions for an org
// conversation - which is why the columns are the caller's to pick rather
// than the file's to dictate.
//
// Pure except for the two download helpers: list in, cells out, so the
// shape of the file is pinned by scripts/siteListExport.test.mjs rather
// than by clicking the button.

import { stripDashes } from './exportSanitize.js';
import { toCsv, downloadCsv } from './csv.js';

/**
 * The columns a saved list can be exported by, in the order the table
 * shows them. Blank and duplicate headers are dropped: a row is an object
 * keyed by header, so a second "City" column was never readable anyway,
 * and a blank one names nothing to tick.
 */
export function siteListColumns(list) {
  const seen = new Set();
  const out = [];
  for (const h of (list?.headers || [])) {
    const name = String(h ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// One cell on the way out. Numbers stay numbers so a spreadsheet sums and
// sorts them; everything else goes out as text with the em dash flattened,
// the same way every other export in the app leaves.
export function exportCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') return stripDashes(String(v));
  return stripDashes(String(v));
}

/**
 * The chosen columns, filtered to the ones the list actually carries and
 * kept in the list's own column order. A selection that has gone stale
 * (the list was replaced by one with different columns) therefore exports
 * what survives rather than a file of empty columns; an empty or missing
 * selection means every column.
 */
export function resolveColumns(list, columns) {
  const all = siteListColumns(list);
  if (!Array.isArray(columns) || columns.length === 0) return all;
  const wanted = new Set(columns.map(c => String(c ?? '').trim()));
  return all.filter(c => wanted.has(c));
}

/**
 * Header row + one row per site, as an array of arrays: what both the
 * workbook and the CSV are built from.
 */
export function siteListExportAoa(list, columns) {
  const cols = resolveColumns(list, columns);
  const rows = (list?.rows || []).map(r => cols.map(c => exportCell(r?.[c])));
  return [cols.map(stripDashes), ...rows];
}

export function siteListCsv(list, columns) {
  const [headers, ...rows] = siteListExportAoa(list, columns);
  return toCsv(headers, rows);
}

/**
 * Column widths for the workbook, sized to the longest cell in each column
 * so the file opens readable instead of opening as a wall of ####. Capped:
 * one long address should not push the rest of the sheet off the screen.
 */
export function columnWidths(aoa) {
  const [headers = [], ...rows] = aoa;
  return headers.map((h, i) => {
    let widest = String(h ?? '').length;
    for (const r of rows) {
      const len = String(r[i] ?? '').length;
      if (len > widest) widest = len;
    }
    return { wch: Math.max(10, Math.min(48, widest + 2)) };
  });
}

/**
 * A filename that survives every filesystem: the company's own name, the
 * characters that don't travel replaced, stamped with the day it was
 * pulled so two exports a week apart don't overwrite each other.
 */
export function siteListFilename(company, ext = 'xlsx', date = new Date()) {
  const safe = String(company || 'company')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'company';
  const d = new Date(date);
  const stamp = isNaN(d) ? '' : `_${d.toISOString().slice(0, 10)}`;
  return `${safe}_site_list${stamp}.${ext}`;
}

// The two that touch the browser. The spreadsheet library is ~140 KB
// gzipped and the popup only needs it when somebody exports, so it is
// pulled in on the click rather than with the modal.
export async function downloadSiteListExcel(list, columns, company, date = new Date()) {
  const aoa = siteListExportAoa(list, columns);
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = columnWidths(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Site List');
  XLSX.writeFile(wb, siteListFilename(company, 'xlsx', date));
}

export function downloadSiteListCsv(list, columns, company, date = new Date()) {
  downloadCsv(siteListFilename(company, 'csv', date), siteListCsv(list, columns));
}
