// My Accounts > Hubspot Mapping > Contacts: an export of the contacts on
// Dan's companies in Schneider's HubSpot, dropped or pasted on the subtab
// and lined up with My Accounts. One row per contact per company:
//   ZoomInfo Company ID | Company ID | Company name | Company owner |
//   Contact Name | Job Title | Contact owner | Create Date | Email |
//   Work email | Email Domain | Last Contacted | Phone Number |
//   LinkedIn URL | Contact ID (and First Name / Last Name when there)
//
// A contact is put on a My Accounts company by its HubSpot Company ID,
// then the company name (activityMatcher, the same rules as the Activity
// subtab), then its email domain against the accounts' Website / Email
// Domain. Each drop replaces the stored contacts: the export is a full
// list, so a contact gone from HubSpot drops off here too.
//
// Pure: runs under plain Node in scripts/hubspotContacts.test.mjs.

import { domainKey } from './seHubspotExisting.js';
import { matchesCdm } from './cdmMatch.js';
import { activityStamp, cleanId, activityMatcher } from './hubspotActivity.js';

// Personal-mail domains are nobody's account domain (as in contactRosters).
const FREE_MAIL = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com']);

const clean = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return /^\(no value\)$/i.test(s) || /^n\/a$/i.test(s) ? '' : s;
};
const norm = (h) => String(h || '').trim().toLowerCase().replace(/_\d+$/, '').replace(/\s+/g, ' ');

// Each field's header names, most specific first.
const HEADERS = {
  companyId: ['company id', 'associated company id', 'company record id', 'primary associated company id'],
  zoomInfoId: ['zoominfo company id'],
  companyName: ['company name', 'associated company', 'primary associated company', 'company'],
  companyOwner: ['company owner'],
  contactName: ['contact name', 'full name', 'name'],
  firstName: ['first name', 'firstname'],
  lastName: ['last name', 'lastname'],
  jobTitle: ['job title', 'title'],
  contactOwner: ['contact owner', 'owner'],
  created: ['create date', 'created date', 'create date (contact)'],
  email: ['email', 'email address'],
  workEmail: ['work email'],
  emailDomain: ['email domain'],
  lastContacted: ['last contacted', 'last contacted date'],
  phone: ['phone number', 'phone', 'mobile phone number'],
  linkedIn: ['linkedin url', 'linkedin profile url', 'linkedin'],
  contactId: ['contact id', 'record id - contact', 'contact record id'],
};

/** Which header of `headers` each field reads from, '' for none. */
export function contactColumns(headers = []) {
  const byNorm = new Map();
  for (const h of headers) { const n = norm(h); if (!byNorm.has(n)) byNorm.set(n, h); }
  const out = {};
  for (const [field, names] of Object.entries(HEADERS)) {
    const hit = names.find(n => byNorm.has(n));
    out[field] = hit ? byNorm.get(hit) : '';
  }
  // A plain Record ID is the contact's when nothing else names it.
  if (!out.contactId && byNorm.has('record id')) out.contactId = byNorm.get('record id');
  return out;
}

/**
 * A contact's name: First + Last when the export has them, else Contact
 * Name. HubSpot's Contact Name is often blank or the job title copied in
 * (Head of Estates); that reads as no name.
 */
export function contactDisplayName(c) {
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  const n = String(c.contactName || '').trim();
  if (!n || (c.jobTitle && n.toLowerCase() === String(c.jobTitle).toLowerCase())) return '';
  return n;
}

const cleanEmail = (v) => {
  const s = clean(v).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? s : '';
};

/** The key two copies of one contact on one company share. */
export function contactKey(c) {
  const who = c.email || c.workEmail || (c.contactId ? `id:${Number(c.contactId).toPrecision(6)}` : `n:${String(c.contactName || '').toLowerCase()}`);
  return `${who}|${c.companyId || String(c.companyName || '').toLowerCase()}`;
}

/**
 * Rows of a contacts export (objects keyed by header) as compact contacts,
 * one per contact per company. A row with no email, name or Contact ID is
 * dropped. Two rows for the same contact and company read once.
 */
export function compactContacts(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const headers = [...new Set(list.flatMap(r => Object.keys(r || {})))];
  const cols = contactColumns(headers);
  const get = (r, f) => (cols[f] ? r[cols[f]] : '');
  const byKey = new Map();
  for (const r of list) {
    if (!r) continue;
    const email = cleanEmail(get(r, 'email'));
    const workEmail = cleanEmail(get(r, 'workEmail'));
    const c = {
      contactId: cleanId(get(r, 'contactId')),
      contactName: clean(get(r, 'contactName')),
      firstName: clean(get(r, 'firstName')),
      lastName: clean(get(r, 'lastName')),
      jobTitle: clean(get(r, 'jobTitle')),
      contactOwner: clean(get(r, 'contactOwner')),
      email,
      workEmail,
      emailDomain: domainKey(clean(get(r, 'emailDomain'))) || domainKey(email || workEmail),
      phone: clean(get(r, 'phone')),
      linkedIn: clean(get(r, 'linkedIn')),
      created: activityStamp(get(r, 'created')),
      lastContacted: activityStamp(get(r, 'lastContacted')),
      companyId: cleanId(get(r, 'companyId')),
      zoomInfoId: cleanId(get(r, 'zoomInfoId')),
      companyName: clean(get(r, 'companyName')),
      companyOwner: clean(get(r, 'companyOwner')),
    };
    if (!c.email && !c.workEmail && !c.contactId && !c.contactName && !c.firstName && !c.lastName) continue;
    byKey.set(contactKey(c), c);
  }
  return { contacts: [...byKey.values()], columns: cols };
}

/**
 * A function from a contact to { row, how } (the My Accounts mapping row
 * it belongs to) or null: by Company ID or company name as activity is,
 * then by the contact's email domain against each account's Website and
 * Email Domain. Personal mail (gmail and the like) never matches a domain.
 */
export function contactMatcher(mapping = [], accounts = []) {
  const byCompany = activityMatcher(mapping, accounts);
  const byDomain = new Map();
  const add = (d, r) => { if (d && !FREE_MAIL.has(d) && !byDomain.has(d)) byDomain.set(d, r); };
  const seen = new Set();
  for (const r of mapping || []) {
    if (!r.account) continue;
    seen.add(r.account.id || r.account.company);
    add(domainKey(r.account.website), r);
    add(domainKey(r.account.emailDomain), r);
  }
  for (const a of accounts || []) {
    if (!a || seen.has(a.id || a.company)) continue;
    const r = { key: `a:${a.id || a.company}`, account: a, hubspot: [], duplicates: [] };
    add(domainKey(a.website), r);
    add(domainKey(a.emailDomain), r);
  }
  return (c) => {
    const hit = byCompany({ companyId: c?.companyId, companyName: c?.companyName });
    if (hit) return hit;
    const d = c?.emailDomain || domainKey(c?.email || c?.workEmail);
    if (d && byDomain.has(d)) return { row: byDomain.get(d), how: 'Email domain' };
    return null;
  };
}

/** The contacts as table rows, each with its account (or none) and whether Dan owns it. */
export function contactRows(contacts = [], match = () => null, me = '') {
  return (contacts || []).map((c, i) => {
    const hit = match(c);
    return {
      ...c,
      id: `${contactKey(c)}#${i}`,
      name: contactDisplayName(c),
      account: hit?.row?.account || null,
      how: hit?.how || '',
      mine: c.contactOwner ? matchesCdm(c.contactOwner, me) : null,
    };
  });
}

/** Contact owners other than `me`, with how many contacts each: [{ name, count }], most first. */
export function contactOwnerSummary(rows = [], me = '') {
  const by = new Map();
  for (const r of rows || []) {
    if (!r.contactOwner || (me && matchesCdm(r.contactOwner, me))) continue;
    by.set(r.contactOwner, (by.get(r.contactOwner) || 0) + 1);
  }
  return [...by].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
