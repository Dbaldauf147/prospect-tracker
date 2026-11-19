// The company card a recipient belongs to, worked out from their email
// address, for a contact whose own Company text is blank. A company card
// already lists such a contact when their domain is one it claims (Email
// Domains or Website, utils/companyRoster); Draft Emails' company variables
// went by the Company text alone, so the same person read as having no
// company and {companyGoesBy} came out blank.
//
// Only a domain claimed by ONE company gives an answer. A domain several
// cards claim (a PE owner's, shared by its portfolio companies) says
// nothing about which of them the person is at.
import { collectClientDomains, FREE_MAIL } from './contactRosters.js';

export function makeCompanyByEmailDomain(prospects) {
  const byDomain = new Map();
  for (const p of prospects || []) {
    if (!String(p?.company || '').trim()) continue;
    const ds = new Set();
    collectClientDomains(p, ds);
    for (const d of ds) {
      if (FREE_MAIL.has(d)) continue;
      // null once a second company claims it.
      byDomain.set(d, byDomain.has(d) && byDomain.get(d) !== p ? null : p);
    }
  }
  return (email) => {
    const e = String(email || '').toLowerCase().trim();
    const at = e.lastIndexOf('@');
    return (at >= 0 && byDomain.get(e.slice(at + 1))) || null;
  };
}
