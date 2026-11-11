// Whether a contact's Company maps to a company on the Table View, and if
// not, which Table View companies it most likely means.
//
// "Mapped" is the same test the contact popup's status pill has always used:
// the normalized name (case, punctuation and corporate suffixes ignored, see
// companyNorm) equals a Table View company's. An unmapped name is what makes
// a contact silently drop off the Client / Key / Key Prospect rosters, the
// status pill and the company link, so the popup warns about it.
//
// Suggestions come from two places, best first:
//   - the email domain: a Table View company whose Email Domain or Website
//     claims the contact's domain (the strongest evidence there is);
//   - the name: a near-name match (rosterKeysMatch, the rosters' own rule).

import { normalizeCompany } from './companyNorm.js';
import { rosterMatchKey, rosterKeysMatch, collectClientDomains, FREE_MAIL } from './contactRosters.js';

function domainOf(email) {
  const e = String(email || '').toLowerCase().trim();
  const at = e.lastIndexOf('@');
  if (at < 0) return '';
  const d = e.slice(at + 1).trim();
  return d && !FREE_MAIL.has(d) ? d : '';
}

/**
 * Build once per prospect list; returns (company, email) =>
 *   { mapped, blank, suggestions: [{ name, via: 'domain' | 'name' }] }
 */
export function makeCompanyMappingCheck(prospects) {
  const rows = (prospects || []).filter(p => String(p?.company || '').trim());
  const byNorm = new Map();
  for (const p of rows) {
    const k = normalizeCompany(p.company);
    if (k && !byNorm.has(k)) byNorm.set(k, String(p.company).trim());
  }
  const names = [...byNorm.values()];
  const keys = names.map(rosterMatchKey);
  const byDomain = new Map();
  for (const p of rows) {
    const ds = new Set();
    collectClientDomains(p, ds);
    const name = byNorm.get(normalizeCompany(p.company));
    for (const d of ds) {
      const list = byDomain.get(d) || [];
      if (!list.includes(name)) list.push(name);
      byDomain.set(d, list);
    }
  }

  return (company, email, { limit = 3 } = {}) => {
    const typed = String(company || '').trim();
    const mapped = !!typed && byNorm.has(normalizeCompany(typed));
    if (mapped) return { mapped: true, blank: false, suggestions: [] };
    const out = [];
    const add = (name, via) => { if (name && !out.some(s => s.name === name)) out.push({ name, via }); };
    for (const n of byDomain.get(domainOf(email)) || []) add(n, 'domain');
    if (typed) {
      const k = rosterMatchKey(typed);
      keys.forEach((key, i) => { if (rosterKeysMatch(key, k)) add(names[i], 'name'); });
    }
    return { mapped: false, blank: !typed, suggestions: out.slice(0, limit) };
  };
}
