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
  subject: ['subject', 'activity subject', 'email subject', 'call title', 'meeting name', 'task title', 'title'],
  toAddress: ['email to address', 'email to', 'to address', 'to', 'recipients'],
  ccAddress: ['email cc address', 'email cc', 'cc address', 'cc'],
  body: ['email body', 'body', 'activity body', 'body preview', 'call notes', 'meeting description', 'note body'],
};

// The longest an email body is kept, in characters. HubSpot's Email body
// is the whole quoted thread; the newest message is what is kept (see
// emailBody), and this caps a long one so thousands of rows still fit.
export const BODY_MAX = 4000;

/**
 * Email To / CC Address as the addresses in it, "; " between, lowercase.
 * Text with no address in it is kept as it is ("(No value)" reads as '').
 */
export function emailAddresses(v) {
  const s = clean(v);
  if (!s) return '';
  const found = s.match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return found ? [...new Set(found.map(e => e.toLowerCase()))].join('; ') : s;
}

// Text that was UTF-8 read as Windows-1252 on the way out of HubSpot or
// Excel: "Iâ€™m" for "I'm", "2â€“3" for "2-3". The usual few are put back.
const MOJIBAKE = [
  ['\u00E2\u20AC\u2122', "'"], ['\u00E2\u20AC\u02DC', "'"],
  ['\u00E2\u20AC\u0153', '"'], ['\u00E2\u20AC\u009D', '"'],
  ['\u00E2\u20AC\u201C', '\u2013'], ['\u00E2\u20AC\u201D', '-'],
  ['\u00E2\u20AC\u00A6', '...'], ['\u00E2\u20AC\u00A2', '\u2022'],
  ['\u00C2\u00A0', ' '], ['\u00C2 ', ' '],
];
const decodeEntities = (t) => t
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');

// Where the quoted thread starts: an Outlook "From: ... Sent:" header, an
// "-----Original Message-----" line, or a Gmail "On ... wrote:".
const THREAD_START = /(^|\n)[ \t]*(From:[^\n]*\n[ \t]*Sent:|-{2,}\s*Original (Message|Appointment)\s*-{2,}|On [^\n]{6,120} wrote:)/i;
// Lines that are mail-system noise, not what anybody wrote.
const NOISE = [
  /\[External email:[^\]]*\]/gi,
  /You don't often get email from [^\n]*?Learn why this is important/gi,
  /Caution: This email originated from outside of the organization\.[^\n]*?(recognize or trust the sender\.)/gi,
  /CGBANNERINDICATOR/g,
];

/**
 * An Email body as the newest message in it: entities decoded, the usual
 * mis-encoded characters put back, mail-system banners dropped, the quoted
 * thread below the first reply header cut off, blank runs collapsed, and
 * capped at BODY_MAX. HubSpot puts a one-paragraph preview of the message
 * before a CGBANNERINDICATOR marker and the message itself after it; the
 * message is kept.
 */
export function emailBody(v) {
  let t = String(v ?? '').replace(/\r\n?/g, '\n');
  if (/^\s*\(no value\)\s*$/i.test(t)) return '';
  t = decodeEntities(t);
  for (const [bad, good] of MOJIBAKE) t = t.split(bad).join(good);
  const banner = t.indexOf('CGBANNERINDICATOR');
  if (banner >= 0) t = t.slice(banner);
  for (const re of NOISE) t = t.replace(re, ' ');
  const cut = t.search(THREAD_START);
  if (cut > 0) t = t.slice(0, cut);
  t = t.split('\n').map(l => l.replace(/[ \t\u00A0]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  return t.length > BODY_MAX ? `${t.slice(0, BODY_MAX).trimEnd()}...` : t;
}

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
      toAddress: emailAddresses(get(r, 'toAddress')),
      ccAddress: emailAddresses(get(r, 'ccAddress')),
      body: emailBody(get(r, 'body')),
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

/** A My Accounts account's tier, as the My Accounts Tier column shows it, '' for none. */
export const accountTier = (account) => String(account?.tierLabel || account?.myTier || account?.tier || '').trim();

/**
 * A "YYYY-MM-DD HH:MM" stamp as a number to sort on (202610191700), null
 * for none. DataTable compares numerically first, and parseFloat of the
 * stamp is just the year, so every date in a year would tie.
 */
export const stampSortValue = (s) => {
  const d = String(s || '').replace(/\D/g, '');
  return d ? Number(d) : null;
};

/** "YYYY-MM-DD HH:MM" as "Oct 19, 2026 5:00 PM", '' for none. */
export function formatActivityDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return String(s || '');
  const [, y, mo, d, h, mi] = m.map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1];
  const hr = h % 12 || 12;
  return `${month} ${d}, ${y} ${hr}:${pad(mi)} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Others' Activity as the Issues tab takes it: the rows on one of My
 * Accounts that somebody other than `me` logged and that aren't ignored
 * (data.ignored), one compact record each, newest first.
 */
export function othersActivityIssueRecords(data, match = () => null, me = '') {
  const ignored = new Set(data?.ignored || []);
  return othersActivityRows(activityRows(data?.activities || [], match, me), me)
    .filter(r => !ignored.has(activityKey(r)))
    .map(r => ({
      key: activityKey(r),
      accountId: r.account?.id || '',
      company: r.account?.company || '',
      salesperson: r.salesperson,
      date: r.date,
      type: r.type,
      subject: r.subject || '',
      hubspotCompany: r.companyName || '',
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * The Issues tab's rows for those records. With `prospects` given, a row
 * whose account is gone (merged or deleted) is left out.
 */
export function othersActivityIssues(records = [], { prospects = [] } = {}) {
  const byId = new Map((prospects || []).map(p => [p.id, p]));
  const check = byId.size > 0;
  const out = [];
  for (const r of records || []) {
    if (!r || !r.key) continue;
    const live = r.accountId ? byId.get(r.accountId) : null;
    if (check && r.accountId && !live) continue;
    const what = [r.type || 'Activity', r.date ? `on ${formatActivityDate(r.date)}` : ''].filter(Boolean).join(' ');
    out.push({
      id: `hubspot-others-activity:${r.key}`,
      source: 'Hubspot Mapping',
      type: 'Activity by another salesperson',
      company: live?.company || r.company || r.hubspotCompany || '-',
      prospectId: live?.id || r.accountId || null,
      daysUntil: null,
      expirationDate: null,
      detail: `${r.salesperson || 'Someone else'} logged ${what} in HubSpot${r.subject ? ` ("${r.subject}")` : ''}. Ignore it on My Accounts > Hubspot Mapping > Activity > Others' Activity to clear it.`,
    });
  }
  return out;
}
