// What the corporate HubSpot portal already holds, read from exports Dan
// takes there (the app has no API access to it), and how the import files
// use it:
//
//   companies  each of Dan's companies is matched to one already in the
//              portal, by domain and then by name. A matched company is left
//              out of the companies file, and its contacts link to the
//              existing record by its Record ID, so the import never makes a
//              second "Rehlko" next to the one the portal had (the first
//              test import did exactly that: the existing record had no
//              domain to match on).
//   contacts   a contact already in the portal and owned by a colleague is
//              left out entirely. The contacts import creates AND updates,
//              and the file carries Dan as owner, so leaving it in would
//              reassign the colleague's contact to him.
//
// Dan can overrule a company match (pick another candidate, or "create
// new"); those choices are kept with the exports.
//
// Pure: no browser APIs, so it runs under plain Node in the tests
// (scripts/seHubspotExisting.test.mjs) and in the weekly email job.

import { normalizeCompany } from './companyNorm.js';

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** 'https://www.Acme.com/about' or 'jane@acme.com' -> 'acme.com'. */
export function domainKey(v) {
  let s = clean(v).toLowerCase();
  if (!s) return '';
  if (s.includes('@')) s = s.split('@').pop();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : '';
}

// A HubSpot export's columns, found by any of the labels HubSpot has used.
function pick(row, ...labels) {
  for (const l of labels) {
    const hit = Object.keys(row).find(k => k.trim().toLowerCase() === l.toLowerCase());
    if (hit && clean(row[hit])) return clean(row[hit]);
  }
  return '';
}

/**
 * Rows of a companies export (objects keyed by header, as sheet_to_json
 * gives them) as [{ id, name, domain, owner }]. A row with neither a name
 * nor a domain says nothing and is dropped.
 */
export function compactCompanies(rows) {
  return (rows || []).map(r => ({
    id: pick(r, 'Record ID', 'Company ID', 'Record ID - Company'),
    name: pick(r, 'Company name', 'Name'),
    domain: domainKey(pick(r, 'Company Domain Name', 'Company domain name', 'Domain')) || domainKey(pick(r, 'Website URL', 'Website')),
    owner: pick(r, 'Company owner', 'Owner'),
  })).filter(c => c.id && (c.name || c.domain));
}

/**
 * Rows of a contacts export as [{ id, email, owner }]. The corporate
 * portal holds far more contacts than Dan's file, so only the ones that can
 * matter are kept: those at an email domain one of Dan's contacts uses
 * (`keepDomains`), which also covers people he adds there later.
 */
export function compactContacts(rows, keepDomains = null) {
  return (rows || []).map(r => ({
    id: pick(r, 'Record ID', 'Contact ID', 'Record ID - Contact'),
    email: pick(r, 'Email', 'Email Address').toLowerCase(),
    owner: pick(r, 'Contact owner', 'Owner'),
  })).filter(c => c.email && (!keepDomains || keepDomains.has(domainKey(c.email))));
}

/**
 * Whether an owner cell names Dan. Exports show the owner as a name ("Dan
 * Baldauf"), sometimes with the email after it; either counts.
 */
export function ownerIsMe(owner, me = []) {
  const o = clean(owner).toLowerCase();
  if (!o) return false;
  return me.map(m => clean(m).toLowerCase()).filter(Boolean).some(m => o === m || o.includes(m));
}

/**
 * A matcher for Dan's companies against the portal's. Returns
 * (prospect) => { company, candidates, how } where `company` is the record
 * to link to (null: create new), `candidates` every record that matched,
 * and `how` 'domain' | 'name' | 'override' | 'none'.
 *
 * Among several candidates (a big company can have a handful in a shared
 * portal) the one Dan owns wins, then a domain match over a name match.
 * `overrides` is { [prospectId]: recordId | 'new' }.
 */
export function companyMatcher(existing = [], { overrides = {}, me = [] } = {}) {
  const byDomain = new Map();
  const byName = new Map();
  const byId = new Map();
  for (const c of existing) {
    byId.set(String(c.id), c);
    if (c.domain) (byDomain.get(c.domain) || byDomain.set(c.domain, []).get(c.domain)).push(c);
    const n = normalizeCompany(c.name);
    if (n) (byName.get(n) || byName.set(n, []).get(n)).push(c);
  }
  return (p) => {
    const domain = domainKey(p.website) || domainKey(p.emailDomain);
    const names = [p.company, p.goesBy, ...(Array.isArray(p.aliases) ? p.aliases : [])].map(normalizeCompany).filter(Boolean);
    const viaDomain = domain ? byDomain.get(domain) || [] : [];
    const viaName = names.flatMap(n => byName.get(n) || []);
    const seen = new Set();
    const candidates = [...viaDomain, ...viaName].filter(c => !seen.has(c.id) && seen.add(c.id));
    const o = overrides[p.id];
    if (o === 'new') return { company: null, candidates, how: 'override' };
    if (o && byId.has(String(o))) return { company: byId.get(String(o)), candidates, how: 'override' };
    if (!candidates.length) return { company: null, candidates, how: 'none' };
    const rank = (c) => (ownerIsMe(c.owner, me) ? 0 : 2) + (viaDomain.includes(c) ? 0 : 1);
    const best = [...candidates].sort((a, b) => rank(a) - rank(b))[0];
    return { company: best, candidates, how: viaDomain.includes(best) ? 'domain' : 'name' };
  };
}

/** The portal's contacts by lower-cased email. */
export function contactsByEmail(existing = []) {
  return new Map(existing.map(c => [c.email, c]));
}
