// My Accounts > Hubspot Mapping > Activity: an export of the activity
// (emails, calls, meetings, notes, tasks) logged on companies in
// Schneider's HubSpot, dropped or pasted on the subtab and lined up with
// My Accounts. The Others' Activity subtab is the same rows narrowed to
// activity somebody other than Dan logged on one of his accounts.
//
// The export is a HubSpot custom report (Companies + Activities), one row
// per activity per company:
//   Company ID | Company name | Company owner | Activity date |
//   Activity type | Engagement ID | Activity created by | Activity assigned to
// "Activity created by" says who logged it, and is the salesperson an
// activity is put on; "Activity assigned to" (or HubSpot user / Activity
// owner) stands in when there is no created-by. With neither, the
// activity can't be put on anyone and Others' Activity stays empty.
//
// Each activity is keyed on its company, its minute, its type, who logged
// it and its Engagement ID to six significant figures. Six because Excel
// shows a 12-digit ID as 1.18921E+11, so a paste carries only that much,
// and an exported file and a paste of the same activity must land on the
// same key. Two drops merge: a row already stored is replaced, the rest
// are kept, so history builds up across exports.
//
// Pure: runs under plain Node in scripts/hubspotActivity.test.mjs.

import { normalizeCompany } from './companyNorm.js';
import { matchesCdm } from './cdmMatch.js';
import { MAPPING_STATUS, splitNameList } from './hubspotMapping.js';

const clean = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return /^\(no value\)$/i.test(s) || /^n\/a$/i.test(s) ? '' : s;
};
const norm = (h) => String(h || '').trim().toLowerCase().replace(/_\d+$/, '').replace(/\s+/g, ' ');

// Each field's header names, most specific first.
const HEADERS = {
  companyId: ['company id', 'company record id', 'record id - company', 'associated company id', 'company: record id'],
  companyName: ['company name', 'associated company', 'company', 'name'],
  companyOwner: ['company owner', 'company: company owner'],
  date: ['activity date', 'date of activity', 'activity timestamp', 'timestamp', 'create date', 'created date', 'date'],
  type: ['activity type', 'engagement type', 'type'],
  engagementId: ['engagement id', 'activity id', 'activity record id'],
  createdBy: ['activity created by', 'created by', 'logged by', 'activity creator'],
  assignedTo: ['activity assigned to', 'assigned to', 'activity owner', 'hubspot user', 'hubspot owner', 'owner'],
  subject: ['subject', 'activity subject', 'email subject', 'call title', 'meeting name', 'task title', 'title', 'body preview', 'activity body'],
};

/** Which header of `headers` each field reads from, '' for none. */
export function activityColumns(headers = []) {
  const byNorm = new Map();
  for (const h of headers) { const n = norm(h); if (!byNorm.has(n)) byNorm.set(n, h); }
  const out = {};
  for (const [field, names] of Object.entries(HEADERS)) {
    const hit = names.find(n => byNorm.has(n));
    out[field] = hit ? byNorm.get(hit) : '';
  }
  // A plain Record ID is the company's when nothing else names it.
  if (!out.companyId && byNorm.has('record id')) out.companyId = byNorm.get('record id');
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (y, mo, d, h = 0, mi = 0) => `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}`;

/**
 * An activity date as "YYYY-MM-DD HH:MM" (local, as HubSpot showed it), ''
 * when it can't be read. Takes a Date (an Excel cell), an Excel serial
 * number, "10/19/2026 17:00", "10/19/2026 5:00 PM", "2026-10-19 17:00" and
 * "2026-10-19T17:00:00Z" style text.
 */
export function activityStamp(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : stamp(v.getFullYear(), v.getMonth() + 1, v.getDate(), v.getHours(), v.getMinutes());
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    // Excel's serial day count, from 1899-12-30, read as wall-clock time.
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    return stamp(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  }
  const s = clean(v);
  if (!s) return '';
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/);
  if (m) {
    let [, mo, d, y, h = '0', mi = '0', ap] = m;
    y = Number(y); if (y < 100) y += 2000;
    let hr = Number(h);
    if (ap) { const pm = /p/i.test(ap); if (hr === 12) hr = pm ? 12 : 0; else if (pm) hr += 12; }
    return stamp(y, Number(mo), Number(d), hr, Number(mi));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', zone] = m;
    if (zone) {
      const t = new Date(s.replace(' ', 'T'));
      if (!Number.isNaN(t.getTime())) return stamp(t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes());
    }
    return stamp(Number(y), Number(mo), Number(d), Number(h), Number(mi));
  }
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? '' : stamp(t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes());
}

/**
 * An ID as its digits. A number keeps every digit; text in Excel's
 * scientific form ("1.18921E+11") is expanded to what it says, which is
 * only that precise.
 */
export function cleanId(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.round(v));
  const s = clean(v).replace(/,/g, '');
  if (!s) return '';
  if (/^\d+$/.test(s)) return s;
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) { const n = Number(s); return Number.isFinite(n) ? String(Math.round(n)) : ''; }
  if (/^\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '');
  return s;
}

// The six significant figures a pasted ID still has, so the file and the
// paste of one activity agree.
const idKey = (id) => {
  const n = Number(id);
  return id && Number.isFinite(n) && /^\d+$/.test(id) ? n.toPrecision(6) : String(id || '');
};

/** Who an activity is put on: who created it, else who it's assigned to. */
export const salespersonOf = (a) => a?.createdBy || a?.assignedTo || '';

/** The key two copies of one activity share. */
export function activityKey(a) {
  return [a.companyId || normalizeCompany(a.companyName), a.date, String(a.type || '').toLowerCase(), idKey(a.engagementId)].join('|');
}

/**
 * Rows of an activity export (objects keyed by header, as sheet_to_json or
 * pastedSheetRows give them) as compact activities. A row with neither a
 * company nor a date is dropped. `hasAssignee` says whether the export
 * names who logged each activity.
 */
export function compactActivities(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const headers = [...new Set(list.flatMap(r => Object.keys(r || {})))];
  const cols = activityColumns(headers);
  const get = (r, f) => (cols[f] ? r[cols[f]] : '');
  const activities = [];
  for (const r of list) {
    if (!r) continue;
    const a = {
      companyId: cleanId(get(r, 'companyId')),
      companyName: clean(get(r, 'companyName')),
      companyOwner: clean(get(r, 'companyOwner')),
      date: activityStamp(get(r, 'date')),
      type: clean(get(r, 'type')),
      engagementId: cleanId(get(r, 'engagementId')),
      createdBy: clean(get(r, 'createdBy')),
      assignedTo: clean(get(r, 'assignedTo')),
      subject: clean(get(r, 'subject')).slice(0, 300),
    };
    if (!a.companyId && !a.companyName) continue;
    if (!a.date && !a.type) continue;
    activities.push(a);
  }
  return { activities, columns: cols, hasAssignee: !!(cols.createdBy || cols.assignedTo) };
}

/**
 * The stored activities with `incoming` merged in: one per key, the newer
 * copy winning, newest first.
 */
export function mergeActivities(stored = [], incoming = []) {
  const byKey = new Map();
  for (const a of stored || []) byKey.set(activityKey(a), a);
  let added = 0;
  for (const a of incoming || []) {
    const k = activityKey(a);
    if (!byKey.has(k)) added += 1;
    byKey.set(k, a);
  }
  const activities = [...byKey.values()].sort((x, y) => String(y.date).localeCompare(String(x.date)));
  return { activities, added, updated: (incoming || []).length - added };
}

const accountNames = (a) => [a.company, a.goesBy, ...splitNameList(a.aliases), ...splitNameList(a.hubspotCompanyNames)]
  .map(normalizeCompany).filter(Boolean);

/**
 * A function from an activity to the My Accounts row it belongs to, built
 * from the Hubspot Mapping rows: its Company ID first (a mapped HubSpot
 * record, or one of that account's duplicates), then its company name
 * against the HubSpot names and the accounts' own names, aliases and
 * HubSpot Company Name(s). Returns { row, how } or null.
 */
export function activityMatcher(mapping = [], accounts = []) {
  const byId = new Map();
  const byName = new Map();
  for (const r of mapping || []) {
    if (!r.account) continue;
    for (const c of [...(r.hubspot || []), ...(r.duplicates || [])]) {
      const id = String(c?.id || '');
      if (id && !/^row-/.test(id) && !byId.has(id)) byId.set(id, r);
      const n = normalizeCompany(c?.name);
      if (n && !byName.has(n)) byName.set(n, r);
    }
  }
  // Accounts first from the mapping (so the row carries its HubSpot side),
  // then any account the mapping doesn't have, as a bare row.
  const seen = new Set();
  for (const r of mapping || []) {
    if (!r.account) continue;
    seen.add(r.account.id || r.account.company);
    for (const n of accountNames(r.account)) if (!byName.has(n)) byName.set(n, r);
  }
  for (const a of accounts || []) {
    if (!a || seen.has(a.id || a.company)) continue;
    const r = { key: `a:${a.id || a.company}`, status: MAPPING_STATUS.accountOnly, account: a, hubspot: [], duplicates: [] };
    for (const n of accountNames(a)) if (!byName.has(n)) byName.set(n, r);
  }
  return (activity) => {
    const id = String(activity?.companyId || '');
    if (id && byId.has(id)) return { row: byId.get(id), how: 'Company ID' };
    const n = normalizeCompany(activity?.companyName);
    if (n && byName.has(n)) return { row: byName.get(n), how: 'Name' };
    return null;
  };
}

/**
 * The activities as table rows, each with the account it maps to (or
 * none). `salesperson` is who it is put on (salespersonOf); `me` is Dan's
 * name: `mine` says whether he logged it, null when the export doesn't say.
 */
export function activityRows(activities = [], match = () => null, me = '') {
  return (activities || []).map((a, i) => {
    const hit = match(a);
    const salesperson = salespersonOf(a);
    return {
      ...a,
      salesperson,
      id: `${activityKey(a)}#${i}`,
      account: hit?.row?.account || null,
      mappingRow: hit?.row || null,
      how: hit?.how || '',
      mine: salesperson ? matchesCdm(salesperson, me) : null,
    };
  });
}

/**
 * Others' Activity: the rows on one of My Accounts logged by somebody
 * other than `me`. Activity with no name on it is left out, since it
 * can't be put on anyone.
 */
export function othersActivityRows(rows = [], me = '') {
  if (!me) return [];
  return (rows || []).filter(r => r.account && r.salesperson && !matchesCdm(r.salesperson, me));
}

/** Others' Activity per salesperson: [{ name, count, accounts, last }], most activity first. */
export function salespeopleSummary(rows = []) {
  const by = new Map();
  for (const r of rows || []) {
    const name = r.salesperson;
    if (!name) continue;
    const s = by.get(name) || { name, count: 0, accounts: new Set(), last: '' };
    s.count += 1;
    if (r.account) s.accounts.add(r.account.company);
    if (r.date > s.last) s.last = r.date;
    by.set(name, s);
  }
  return [...by.values()]
    .map(s => ({ ...s, accounts: s.accounts.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** "YYYY-MM-DD HH:MM" as "Oct 19, 2026 5:00 PM", '' for none. */
export function formatActivityDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return String(s || '');
  const [, y, mo, d, h, mi] = m.map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1];
  const hr = h % 12 || 12;
  return `${month} ${d}, ${y} ${hr}:${pad(mi)} ${h < 12 ? 'AM' : 'PM'}`;
}
