// The site's own data as HubSpot import files, for a portal the app can't
// reach through the API (the corporate one, where IT allows no private or
// installed apps). The user downloads these and uploads them with HubSpot's
// own Import screen.
//
// What goes in, and how the files find each other inside HubSpot:
//
//   companies  the prospects that matter (with a contact or an Opp, unless
//              asked for all; Opps only pick the companies, they are not
//              exported as deals: Dan doesn't track Opps in HubSpot),
//              keyed by Company Domain Name, which is how a HubSpot import
//              de-duplicates companies
//   contacts   the contact list (the app's copy of the current portal),
//              keyed by Email, with Company Domain Name so the import links
//              each contact to its company
//              and, from the saved backup of the current portal, its
//              activity history as three fields: HubSpot's import takes no
//              emails, meetings or notes, so a dated line per activity is
//              the history that can travel
//   fields     the custom properties the files use, with a suggested type
//              and the dropdown options seen in the data, for whoever
//              creates them in the portal before the first import
//
// Pure: no browser APIs, so it runs under plain Node in the tests
// (scripts/hubspotImportFiles.test.mjs).

import { normalizeCompany } from './companyNorm.js';

// One header per HubSpot property label. HubSpot's import matches columns to
// properties by label, so the standard ones use HubSpot's own wording.
export const COMPANY_HEADERS = [
  'Company Domain Name', 'Name', 'Website URL', 'Company owner',
  'Vertical', 'Sub Vertical', 'Account Type', 'Prospect Status', 'Tier', 'HQ Region', 'CDM',
  'Prospect Tracker ID',
];
export const CONTACT_HEADERS = [
  'Email', 'First Name', 'Last Name', 'Job Title', 'Phone Number', 'Mobile Phone Number',
  'City', 'State/Region', 'Country/Region', 'LinkedIn URL', 'Contact owner',
  'Company Name', 'Company Domain Name', "Dan's Tags", 'Decision Maker', 'Role',
  'Activity History', 'Last Activity Date', 'Activity Count',
];
export const FIELD_HEADERS = ['Object', 'Property label', 'Suggested type', 'Options seen in the data', 'Why'];

/** 'https://www.Acme.com/about' -> 'acme.com'. '' when there is none. */
export function domainOf(v) {
  let s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('@')) s = s.split('@').pop();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : '';
}

// Free mail domains: a contact's address there says nothing about the
// company, so it is never used to link one.
const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'live.com', 'msn.com', 'me.com', 'protonmail.com']);

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const tagsOf = (c) => String(c.dans_tags || c.dan_s_tags || c.dans_tag || '').split(';').map(t => t.trim()).filter(Boolean);
const isHidden = (c) => tagsOf(c).some(t => t.toLowerCase() === 'hide');

function prospectDomain(p) {
  return domainOf(p.website) || domainOf(p.emailDomain);
}

// Money as HubSpot wants it: digits and a point. '$120,000' -> '120000'.
export function amountOf(v) {
  const s = String(v ?? '').replace(/[^0-9.-]/g, '');
  const n = Number(s);
  return s && Number.isFinite(n) ? String(n) : '';
}

// A date as YYYY-MM-DD, which HubSpot's import reads whatever format the
// user picks for the rest. '' for anything that isn't a date.
export function dateOf(v) {
  const s = clean(v);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// HubSpot's cap on a multi-line text value is 65,536 characters; staying
// under it with room to spare, so a busy contact's history is trimmed here
// (oldest first) rather than refused by the import.
export const HISTORY_MAX_CHARS = 60000;

const utcDay = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

/**
 * One contact's activity entries ([whenMs, kind, subject]) as the three
 * history fields:
 *   { history, lastDate, count }
 * `history` is one line per activity, newest first, "YYYY-MM-DD Kind:
 * subject"; repeats (the same email logged twice) count once. When the
 * lines run past `maxChars`, the oldest are dropped and the last line says
 * how many.
 */
export function formatActivityHistory(entries, maxChars = HISTORY_MAX_CHARS) {
  const seen = new Set();
  const list = [];
  for (const [when, kind, subject] of entries || []) {
    const key = `${when}|${kind}|${subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push([Number(when) || 0, String(kind || ''), String(subject || '')]);
  }
  list.sort((a, b) => b[0] - a[0]);
  if (!list.length) return { history: '', lastDate: '', count: 0 };
  const lines = [];
  let used = 0;
  for (let i = 0; i < list.length; i += 1) {
    const [when, kind, subject] = list[i];
    const line = `${utcDay(when) || 'undated'} ${kind}: ${subject}`;
    const note = `(+${list.length - i} older not shown)`;
    if (used + line.length + 1 + note.length > maxChars) { lines.push(note); break; }
    lines.push(line);
    used += line.length + 1;
  }
  return { history: lines.join('\n'), lastDate: utcDay(list[0][0]), count: list.length };
}

/**
 * The Opps still in play from an Opps 2 dataset: its records minus any
 * listed in `_deletedIds`. That is a map of id -> deletedAt
 * (utils/opps2Store.js); a plain list of ids is read too.
 */
export function liveOpps(data) {
  const del = data?._deletedIds;
  const ids = Array.isArray(del) ? del : (del && typeof del === 'object' ? Object.keys(del) : []);
  const deleted = new Set(ids.map(String));
  return (Array.isArray(data?.records) ? data.records : []).filter(r => r && !deleted.has(String(r._id ?? r.id)));
}

/**
 * Build the files.
 *   prospects   the site's companies
 *   contacts    the contact list (the HubSpot cache)
 *   opps        Opps 2 records
 *   settings    for the per-contact company pins (contactLocalFields)
 *   ownerEmail  who owns every record in the new portal
 *   allCompanies  every prospect, rather than only those with a contact or opp
 *   activity    { [contactId]: [[whenMs, kind, subject], ...] } from the
 *               backup (api/_lib/activityDigest.js); none leaves the
 *               history fields blank
 * Returns { companies, contacts, fields } as { headers, rows } plus
 * `report`: counts and what was left out and why.
 */
export function buildImportFiles({
  prospects = [], contacts = [], opps = [], settings = {}, ownerEmail = '', allCompanies = false, activity = null,
} = {}) {
  const report = {
    contactsWithHistory: 0, contactsNoEmail: 0, contactsHidden: 0, contactsDuplicateEmail: 0, contactsNoCompany: 0,
    companiesNoDomain: [],
  };

  // Prospects by every name they go by.
  const byName = new Map();
  for (const p of prospects) {
    for (const n of [p.company, p.goesBy, ...(Array.isArray(p.aliases) ? p.aliases : [])]) {
      const k = normalizeCompany(n);
      if (k && !byName.has(k)) byName.set(k, p);
    }
  }
  const byDomain = new Map();
  for (const p of prospects) {
    const d = prospectDomain(p);
    if (d && !byDomain.has(d)) byDomain.set(d, p);
  }
  const findProspect = (name) => byName.get(normalizeCompany(name)) || null;

  const used = new Set(); // prospect ids with a contact or an opp
  const local = settings.contactLocalFields || {};

  // ── Contacts ──
  // Activity by email: contacts sharing an address become one row, so the
  // history of every one of them goes on it.
  const activityByEmail = new Map();
  if (activity) {
    for (const c of contacts) {
      const e = clean(c?.email).toLowerCase();
      const a = activity[String(c?.id)];
      if (e && a?.length) activityByEmail.set(e, [...(activityByEmail.get(e) || []), ...a]);
    }
  }
  const seen = new Set();
  const contactRows = [];
  for (const c of contacts) {
    if (isHidden(c)) { report.contactsHidden += 1; continue; }
    const email = clean(c.email).toLowerCase();
    if (!email) { report.contactsNoEmail += 1; continue; }
    if (seen.has(email)) { report.contactsDuplicateEmail += 1; continue; }
    seen.add(email);

    const companyName = clean(local[c.id]?._companyOverride || c.company || c.companyText);
    const mailDomain = domainOf(email);
    const prospect = (companyName && findProspect(companyName))
      || (!FREE_MAIL.has(mailDomain) && byDomain.get(mailDomain)) || null;
    const domain = prospect ? prospectDomain(prospect) : '';
    if (prospect) {
      used.add(prospect.id);
    } else {
      report.contactsNoCompany += 1;
    }

    contactRows.push([
      email, clean(c.firstname), clean(c.lastname), clean(c.jobtitle), clean(c.phone), clean(c.mobilephone),
      clean(c.city), clean(c.state), clean(c.country), clean(c.hs_linkedin_url || c.linkedin_url), ownerEmail,
      prospect ? clean(prospect.company) : companyName, domain,
      tagsOf(c).join(';'), clean(c.decision_maker), clean(c.role),
      ...(() => {
        const h = formatActivityHistory(activityByEmail.get(email));
        if (h.count) report.contactsWithHistory += 1;
        return [h.history, h.lastDate, h.count ? String(h.count) : ''];
      })(),
    ]);
  }

  // ── Opps: only to say which companies are live accounts ──
  for (const o of opps) {
    const prospect = o && clean(o.Account) ? findProspect(o.Account) : null;
    if (prospect) used.add(prospect.id);
  }

  // ── Companies ──
  const companyRows = [];
  for (const p of prospects) {
    if (!allCompanies && !used.has(p.id)) continue;
    const domain = prospectDomain(p);
    if (!domain) report.companiesNoDomain.push(clean(p.company));
    companyRows.push([
      domain, clean(p.company), clean(p.website), ownerEmail,
      clean(p.vertical), clean(p.subVertical), clean(p.type), clean(p.status), clean(p.tier),
      clean(p.hqRegion), clean(p.cdm), clean(p.id),
    ]);
  }

  // ── Fields to create ──
  const distinct = (rows, i) => [...new Set(rows.map(r => r[i]).flatMap(v => String(v).split(';')).map(s => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const col = (headers, label) => headers.indexOf(label);
  const opts = (rows, headers, label, max = 60) => {
    const all = distinct(rows, col(headers, label));
    return all.length > max ? `${all.slice(0, max).join('; ')} (+${all.length - max} more)` : all.join('; ');
  };
  const fieldRows = [
    ['Contact', "Dan's Tags", 'Multiple checkboxes', opts(contactRows, CONTACT_HEADERS, "Dan's Tags", 500), 'Your tags; several per contact, separated by ;'],
    ['Contact', 'Decision Maker', 'Dropdown select', opts(contactRows, CONTACT_HEADERS, 'Decision Maker'), ''],
    ['Contact', 'Role', 'Single-line text', '', ''],
    ['Contact', 'Activity History', 'Multi-line text', '', 'Emails, meetings, notes, calls and tasks from the old portal, one dated line each, newest first'],
    ['Contact', 'Last Activity Date', 'Date picker', '', 'Date of the newest line in Activity History'],
    ['Contact', 'Activity Count', 'Number', '', 'How many activities the history holds'],
    ['Company', 'Vertical', 'Dropdown select', opts(companyRows, COMPANY_HEADERS, 'Vertical'), ''],
    ['Company', 'Sub Vertical', 'Single-line text', '', ''],
    ['Company', 'Account Type', 'Dropdown select', opts(companyRows, COMPANY_HEADERS, 'Account Type'), "The site's company Type"],
    ['Company', 'Prospect Status', 'Dropdown select', opts(companyRows, COMPANY_HEADERS, 'Prospect Status'), ''],
    ['Company', 'Tier', 'Dropdown select', opts(companyRows, COMPANY_HEADERS, 'Tier'), ''],
    ['Company', 'HQ Region', 'Dropdown select', opts(companyRows, COMPANY_HEADERS, 'HQ Region'), ''],
    ['Company', 'CDM', 'Single-line text', '', ''],
    ['Company', 'Prospect Tracker ID', 'Single-line text', '', 'Lets a later import update instead of duplicate'],
  ];

  return {
    companies: { headers: COMPANY_HEADERS, rows: companyRows },
    contacts: { headers: CONTACT_HEADERS, rows: contactRows },
    fields: { headers: FIELD_HEADERS, rows: fieldRows },
    report,
  };
}
