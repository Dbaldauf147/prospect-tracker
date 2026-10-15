// The Bulk Add > Zoom Search Log subtab: what has been pulled out of
// ZoomInfo, company by company.
//
// Two kinds of search get logged. A company search is the pull by Zoom
// Company ID (every contact at the account). A title search is the pull by
// job title for one tag's persona, and it records which titles were typed
// in and for which tag, so the next pull for that tag at that company can
// start from what was already tried instead of from memory.
//
// The input is whatever ZoomInfo's Excel export looks like once it is
// copied out of Excel: tab-separated, a header row first. Only the columns
// worth keeping are read (company id, company name, website, job title) and
// the rows collapse to one entry per company.
//
// Pure, so it can be asserted without a browser:
// scripts/zoomSearchLog.test.mjs.

import { normZoomCompany } from './zoomExportExclude.js';

export const ZOOM_SEARCH_LOG_KEY = 'zoom-search-log';

export const SEARCH_TYPES = [
  { key: 'company', label: 'Company Zoom ID search' },
  { key: 'title',   label: 'Title search' },
];

const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Header spellings, matched after normHeader. First match wins, so the
// specific "ZoomInfo Company ID" beats a bare "Company ID".
const HEADER_ALIASES = {
  zoomId: ['zoominfocompanyid', 'zoomcompanyid', 'zicompanyid', 'companyzoominfoid', 'zoominfoid', 'companyid'],
  name: ['companyname', 'zoomcompanyname', 'company', 'accountname', 'organization'],
  website: ['website', 'companywebsite', 'companyurl', 'companydomain', 'domain', 'url'],
  title: ['jobtitle', 'title', 'contacttitle'],
};

/**
 * Split pasted spreadsheet text into rows of cells. Tabs separate cells
 * (Excel's clipboard); a line with no tab but commas is read as CSV. A
 * quoted cell may hold tabs, commas or line breaks.
 */
export function splitPastedTable(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const firstLine = src.split('\n', 1)[0] || '';
  const sep = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows
    .map(r => r.map(c => c.trim()))
    .filter(r => r.some(c => c !== ''));
}

function findColumn(headers, aliases) {
  const norm = headers.map(normHeader);
  for (const a of aliases) {
    const i = norm.indexOf(a);
    if (i !== -1) return i;
  }
  return -1;
}

// A Zoom ID as typed in a sheet: digits only, so "1113193043.0" (a number
// cell Excel reformatted) and "1113193043" are one company.
export function cleanZoomId(v) {
  const s = String(v ?? '').trim().replace(/\.0+$/, '');
  return /^\d+$/.test(s) ? s : '';
}

// The identity a company is logged under: its Zoom ID, or its normalized
// name when the export had no ID for it.
export function companyKey(c) {
  const id = cleanZoomId(c?.zoomId);
  if (id) return `id:${id}`;
  const n = normZoomCompany(c?.name);
  return n ? `name:${n}` : '';
}

/**
 * Read a pasted ZoomInfo export.
 * Returns { companies, contactCount, columns, error }, where companies is
 * one entry per company: { zoomId, name, website, contacts, titles }.
 */
export function parseZoomPaste(text) {
  const rows = splitPastedTable(text);
  if (rows.length < 2) {
    return { companies: [], contactCount: 0, columns: {}, error: 'Paste the header row and at least one row under it.' };
  }
  const headers = rows[0];
  const columns = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) columns[field] = findColumn(headers, aliases);
  if (columns.zoomId === -1 && columns.name === -1) {
    return { companies: [], contactCount: 0, columns, error: 'No "ZoomInfo Company ID" or "Company Name" column in the header row.' };
  }
  const at = (r, i) => (i >= 0 ? String(r[i] || '').trim() : '');
  const byKey = new Map();
  let contactCount = 0;
  for (const r of rows.slice(1)) {
    const entry = { zoomId: cleanZoomId(at(r, columns.zoomId)), name: at(r, columns.name) };
    const key = companyKey(entry);
    if (!key) continue;
    contactCount += 1;
    let c = byKey.get(key);
    if (!c) {
      c = { zoomId: entry.zoomId, name: entry.name, website: at(r, columns.website), contacts: 0, titles: [] };
      byKey.set(key, c);
    }
    c.contacts += 1;
    if (!c.name && entry.name) c.name = entry.name;
    if (!c.website) c.website = at(r, columns.website);
    const title = at(r, columns.title);
    if (title && !c.titles.includes(title)) c.titles.push(title);
  }
  const companies = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { companies, contactCount, columns, error: companies.length ? '' : 'No company rows found under the header.' };
}

/** Title list as typed: one per line or comma separated, duplicates dropped. */
export function splitTitles(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/[\n,;]/)) {
    const t = raw.trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

/** The stored log, whatever was in storage: { searches: [] }. */
export function readLog(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { searches: Array.isArray(v?.searches) ? v.searches.filter(s => s && typeof s === 'object') : [] };
  } catch {
    return { searches: [] };
  }
}

/**
 * A search entry ready to store. Companies are kept to the id and name
 * (the rest of the paste is not the log's business).
 */
export function makeSearch({ id, type, date, tag = '', titles = [], companies = [], contactCount = 0, note = '' }) {
  return {
    id,
    type: type === 'title' ? 'title' : 'company',
    date,
    tag: type === 'title' ? String(tag || '').trim() : '',
    titles: type === 'title' ? titles : [],
    companies: companies.map(c => ({ zoomId: cleanZoomId(c.zoomId), name: String(c.name || '').trim() })),
    contacts: contactCount,
    note: String(note || '').trim(),
  };
}

/**
 * The log by company, newest search first inside each:
 * [{ key, zoomId, name, companySearches: [date], titleSearches: [{ tag, titles, date }] }]
 */
export function companyLog(searches) {
  const byKey = new Map();
  const ordered = [...(searches || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  for (const s of ordered) {
    for (const c of (s.companies || [])) {
      const key = companyKey(c);
      if (!key) continue;
      let row = byKey.get(key);
      if (!row) {
        row = { key, zoomId: cleanZoomId(c.zoomId), name: c.name || '', companySearches: [], titleSearches: [] };
        byKey.set(key, row);
      }
      if (!row.name && c.name) row.name = c.name;
      if (s.type === 'title') row.titleSearches.push({ tag: s.tag || '', titles: s.titles || [], date: s.date || '' });
      else if (!row.companySearches.includes(s.date)) row.companySearches.push(s.date || '');
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * (company) => Table View prospect or null: by Zoom Company ID first, then
 * by name (the prospect's company or its Zoom Company Name), compared the
 * way the Zoom exports compare them.
 */
export function buildProspectMatcher(prospects) {
  const byId = new Map();
  const byName = new Map();
  for (const p of (prospects || [])) {
    const id = cleanZoomId(p?.zoomCompanyId);
    if (id && !byId.has(id)) byId.set(id, p);
    for (const n of [p?.company, p?.zoomCompanyName]) {
      const k = normZoomCompany(n);
      if (k && !byName.has(k)) byName.set(k, p);
    }
  }
  return (c) => {
    const id = cleanZoomId(c?.zoomId);
    if (id && byId.has(id)) return byId.get(id);
    return byName.get(normZoomCompany(c?.name)) || null;
  };
}

/**
 * The title searches logged against one company, newest first:
 * [{ tag, titles, date, contacts }]. The company is a Table View record's
 * identity ({ company, zoomCompanyId, zoomCompanyName }) and a logged
 * company counts as it by Zoom Company ID, or by either name, compared the
 * way the Zoom exports compare them. Read by the company popup's Contacts >
 * By Category table, one cell per tag.
 */
export function titleSearchesForCompany(searches, { company = '', zoomCompanyId = '', zoomCompanyName = '' } = {}) {
  const id = cleanZoomId(zoomCompanyId);
  const names = new Set([company, zoomCompanyName].map(normZoomCompany).filter(Boolean));
  if (!id && !names.size) return [];
  const isThis = (c) => {
    const cid = cleanZoomId(c?.zoomId);
    if (id && cid) return cid === id;
    const n = normZoomCompany(c?.name);
    return !!n && names.has(n);
  };
  return (searches || [])
    .filter(s => s?.type === 'title' && (s.companies || []).some(isThis))
    .map(s => ({ tag: s.tag || '', titles: s.titles || [], date: s.date || '', contacts: s.contacts || 0 }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
