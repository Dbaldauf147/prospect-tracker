// Is this contact at one of MY accounts - a Table View company whose CDM is
// the signed-in user's?
//
// The contact is paired with a company exactly the way the contacts tables
// fill their CDM column (KeyContactsView's by-company rows): the company
// text has to equal a prospect's Company (case and spacing aside), and only
// a contact with no company at all falls back to its email domain. Fuzzy
// matching is deliberately absent here too, so the filter can never keep a
// row whose CDM cell reads somebody else's name, or "-".
//
// A Company typed in the app (the `_companyOverride` pin in
// settings.contactLocalFields) wins over HubSpot's text, as it does on
// every contacts page.

import { matchesCdm } from './cdmMatch.js';

const FREE_MAIL = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
]);

function prospectDomains(p) {
  const out = [];
  if (p.emailDomain) {
    for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
      const at = entry.lastIndexOf('@');
      const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
      if (d) out.push(d);
    }
  }
  if (p.website) {
    const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
    if (d) out.push(d);
  }
  return out;
}

/**
 * A predicate (contact) => boolean, true when the contact's company is a
 * prospect on `cdmName`'s CDM. With no CDM name set there is nobody to
 * scope to, so every contact passes.
 */
export function makeMyCdmContactGate({ prospects = [], cdmName = '', localFields = null } = {}) {
  if (!String(cdmName || '').trim()) return () => true;
  // First prospect wins on a duplicate name or domain, as it does in the
  // table's own lookup (Array.find).
  const byName = new Map();
  const byDomain = new Map();
  for (const p of prospects || []) {
    if (!p) continue;
    const name = String(p.company || '').toLowerCase().trim();
    if (name && !byName.has(name)) byName.set(name, p);
    for (const d of prospectDomains(p)) if (!byDomain.has(d)) byDomain.set(d, p);
  }
  return (c) => {
    if (!c) return false;
    const local = localFields ? localFields[String(c.id || c.vid || '')] : null;
    const override = local && typeof local._companyOverride === 'string' ? local._companyOverride : '';
    const company = String(override || c.company || '').toLowerCase().trim();
    let p = null;
    if (company) {
      p = byName.get(company) || null;
    } else {
      const email = String(c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const domain = at >= 0 ? email.slice(at + 1).trim() : '';
      if (domain && !FREE_MAIL.has(domain)) p = byDomain.get(domain) || null;
    }
    return !!p && matchesCdm(p.cdm, cdmName);
  };
}
