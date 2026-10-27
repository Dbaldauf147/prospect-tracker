// The site's own data as HubSpot import files, for a portal the app can't
// reach through the API (the corporate one, where IT allows no private or
// installed apps). The user downloads these and uploads them with HubSpot's
// own Import screen.
//
// What goes in, and how the files find each other inside HubSpot:
//
//   companies  the prospects that matter (with a contact or an opp, unless
//              asked for all), keyed by Company Domain Name, which is how a
//              HubSpot import de-duplicates companies
//   contacts   the contact list (the app's copy of the current portal),
//              keyed by Email, with Company Domain Name so the import links
//              each contact to its company
//   deals      the Opps, with Company Domain Name and the contact's email
//              for the links, and the Opp's own id so a later round can be
//              told apart from a duplicate
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
];
export const DEAL_HEADERS = [
  'Deal Name', 'Pipeline', 'Deal Stage', 'Amount', 'Close Date', 'Deal owner',
  'Company Domain Name', 'Contact Email', 'Scope', 'Opp Source', 'Estimated Fee',
  'BFO Opportunity Name', 'Prospect Tracker ID',
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
 * Build the four files.
 *   prospects   the site's companies
 *   contacts    the contact list (the HubSpot cache)
 *   opps        Opps 2 records
 *   settings    for the per-contact company pins (contactLocalFields)
 *   ownerEmail  who owns every record in the new portal
 *   pipeline    the deal pipeline's label in the new portal
 *   allCompanies  every prospect, rather than only those with a contact or opp
 * Returns { companies, contacts, deals, fields } as { headers, rows } plus
 * `report`: counts and what was left out and why.
 */
export function buildImportFiles({
  prospects = [], contacts = [], opps = [], settings = {}, ownerEmail = '', pipeline = '', allCompanies = false,
} = {}) {
  const report = {
    contactsNoEmail: 0, contactsHidden: 0, contactsDuplicateEmail: 0, contactsNoCompany: 0,
    companiesNoDomain: [], dealsNoCompany: [], dealsNoDomain: [],
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
  const seen = new Set();
  const contactRows = [];
  const contactsByCompany = new Map(); // prospect id -> [{ name, email }]
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
      const list = contactsByCompany.get(prospect.id) || [];
      list.push({ name: normalizeCompany(`${c.firstname || ''} ${c.lastname || ''}`), email });
      contactsByCompany.set(prospect.id, list);
    } else {
      report.contactsNoCompany += 1;
    }

    contactRows.push([
      email, clean(c.firstname), clean(c.lastname), clean(c.jobtitle), clean(c.phone), clean(c.mobilephone),
      clean(c.city), clean(c.state), clean(c.country), clean(c.hs_linkedin_url || c.linkedin_url), ownerEmail,
      prospect ? clean(prospect.company) : companyName, domain,
      tagsOf(c).join(';'), clean(c.decision_maker), clean(c.role),
    ]);
  }

  // ── Deals ──
  const dealRows = [];
  for (const o of opps) {
    if (!o || o._deleted) continue;
    const account = clean(o.Account);
    const prospect = account ? findProspect(account) : null;
    const scope = clean(o.Scope);
    const name = [account || 'Unnamed account', scope].filter(Boolean).join(' - ');
    if (!prospect) report.dealsNoCompany.push(name);
    const domain = prospect ? prospectDomain(prospect) : '';
    if (prospect) {
      used.add(prospect.id);
      if (!domain) report.dealsNoDomain.push(name);
    }
    // The Opp names its contact in free text; link it when that name is a
    // contact at the same company.
    const who = normalizeCompany(o.Contact);
    const contactEmail = prospect && who
      ? (contactsByCompany.get(prospect.id) || []).find(x => x.name === who)?.email || ''
      : '';
    dealRows.push([
      name, pipeline, clean(o.Stage) || 'Lead', amountOf(o['Quoted Amount']) || amountOf(o['Estimated Fee']),
      dateOf(o['Close Date']), ownerEmail, domain, contactEmail, scope, clean(o.Source || o['Lead Source']),
      amountOf(o['Estimated Fee']), clean(o['BFO Link']), clean(o._id || o.id),
    ]);
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
    ['Company', 'Vertical', 'Dropdown select', opts(companyRows, COMPANY_HEADERS, 'Vertical'), ''],
    ['Company', 'Sub Vertical', 'Single-line text', '', ''],
    ['Company', 'Account Type', 'Dropdown select', opts(companyRows, COMPANY_HEADERS, 'Account Type'), "The site's company Type"],
    ['Company', 'Prospect Status', 'Dropdown select', opts(companyRows, COMPANY_HEADERS, 'Prospect Status'), ''],
    ['Company', 'Tier', 'Dropdown select', opts(companyRows, COMPANY_HEADERS, 'Tier'), ''],
    ['Company', 'HQ Region', 'Dropdown select', opts(companyRows, COMPANY_HEADERS, 'HQ Region'), ''],
    ['Company', 'CDM', 'Single-line text', '', ''],
    ['Company', 'Prospect Tracker ID', 'Single-line text', '', 'Lets a later import update instead of duplicate'],
    ['Deal', 'Deal Stage', '(pipeline stages)', opts(dealRows, DEAL_HEADERS, 'Deal Stage'), 'Each of these must be a stage in the pipeline, or be mapped to one during the import'],
    ['Deal', 'Scope', 'Single-line text', '', ''],
    ['Deal', 'Opp Source', 'Dropdown select', opts(dealRows, DEAL_HEADERS, 'Opp Source'), ''],
    ['Deal', 'Estimated Fee', 'Number', '', ''],
    ['Deal', 'BFO Opportunity Name', 'Single-line text', '', ''],
    ['Deal', 'Prospect Tracker ID', 'Single-line text', '', 'Lets a later import update instead of duplicate'],
  ];

  return {
    companies: { headers: COMPANY_HEADERS, rows: companyRows },
    contacts: { headers: CONTACT_HEADERS, rows: contactRows },
    deals: { headers: DEAL_HEADERS, rows: dealRows },
    fields: { headers: FIELD_HEADERS, rows: fieldRows },
    report,
  };
}
