// Shared "guess a Table View company for this HubSpot contact"
// helpers, originally lifted out of HubSpotView so the Active Contacts
// page can show the same Suggested Company hints HubSpot Contacts uses.
//
// All exports are pure — no React, no DOM. Build the index maps once
// per `prospects` change and reuse for every contact lookup.

export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
]);

const TWO_PART_TLDS = new Set([
  'co.uk', 'co.jp', 'com.au', 'com.br', 'co.nz', 'com.mx', 'co.in',
]);

const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;

// Strip parentheticals, corporate suffixes, punctuation, and accents
// so "Acme, Inc." and "Acme Corporation" collapse to the same key.
export function normalizeCompanyKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract a brand from an email domain. "urw.com" → "Urw",
// "ext.urw.com" → "Urw", "acme.co.uk" → "Acme". Returns "" for
// free-mail providers so contacts from personal inboxes don't end up
// with a bogus guessed company.
export function brandFromDomain(domain) {
  if (!domain || FREE_MAIL_DOMAINS.has(domain)) return '';
  const parts = domain.split('.').filter(Boolean);
  if (parts.length < 2) return '';
  const lastTwo = parts.slice(-2).join('.');
  const brand = (TWO_PART_TLDS.has(lastTwo) && parts.length >= 3)
    ? parts[parts.length - 3]
    : parts[parts.length - 2];
  if (!brand) return '';
  return brand.replace(/\b\w/g, ch => ch.toUpperCase());
}

// Build the lookup index off the prospects list (and optionally the
// existing HubSpot contacts so a domain seen on one contact can suggest
// the same company for another). Returns an object with three maps and
// a precomputed sorted prefix list.
export function buildCompanyGuessIndex(prospects, contacts = []) {
  const domainToCompany = new Map();
  for (const p of (prospects || [])) {
    if (p?.emailDomain) {
      const entries = String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
      for (const entry of entries) {
        const at = entry.lastIndexOf('@');
        const domain = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase();
        if (domain && p.company && !domainToCompany.has(domain)) domainToCompany.set(domain, p.company);
      }
    }
    if (p?.website) {
      const webDomain = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
      if (webDomain && p.company && !domainToCompany.has(webDomain)) domainToCompany.set(webDomain, p.company);
    }
  }
  for (const c of (contacts || [])) {
    if (c?.company && c?.email) {
      const at = String(c.email).lastIndexOf('@');
      if (at >= 0) {
        const domain = c.email.slice(at + 1).toLowerCase();
        if (domain && !domainToCompany.has(domain)) domainToCompany.set(domain, c.company);
      }
    }
  }

  const keyToCanonical = new Map();
  const tokenPrefixMap = new Map();
  for (const p of (prospects || [])) {
    const k = normalizeCompanyKey(p?.company);
    if (k && !keyToCanonical.has(k)) keyToCanonical.set(k, p.company);
    if (!k) continue;
    const tokens = k.split(' ').filter(Boolean);
    for (let n = 1; n <= tokens.length; n++) {
      const prefix = tokens.slice(0, n).join('');
      if (prefix && prefix.length >= 3 && !tokenPrefixMap.has(prefix)) tokenPrefixMap.set(prefix, p.company);
    }
  }
  const tokenPrefixKeysDesc = Array.from(tokenPrefixMap.keys()).sort((a, b) => b.length - a.length);

  return { domainToCompany, keyToCanonical, tokenPrefixMap, tokenPrefixKeysDesc };
}

function findByCompactKey(idx, queryCompact) {
  if (!queryCompact || queryCompact.length < 3) return '';
  const exact = idx.tokenPrefixMap.get(queryCompact);
  if (exact) return exact;
  for (const key of idx.tokenPrefixKeysDesc) {
    if (key.length < 5) break;
    if (queryCompact.startsWith(key) || key.startsWith(queryCompact)) {
      return idx.tokenPrefixMap.get(key) || '';
    }
  }
  return '';
}

// Suggest a Table View company name for a HubSpot-shaped contact.
// Falls back through:
//   1. If the contact has a Company text that normalizes to a known
//      prospect key, return the prospect's canonical spelling.
//   2. Otherwise look up the email domain.
//   3. Otherwise extract a brand from the domain and probe the prefix
//      index ("strategichotels.com" → "Strategic Hotels & Resorts").
// Returns "" when nothing confident comes up.
export function guessCompanyForContact(contact, idx) {
  if (!contact || !idx) return '';
  const company = contact.company || '';
  const email = (contact.email || '').toLowerCase().trim();
  const at = email.lastIndexOf('@');
  const domain = at >= 0 ? email.slice(at + 1).trim() : '';

  if (company) {
    const currentLower = company.toLowerCase();
    const normKey = normalizeCompanyKey(company);
    if (normKey) {
      let canonical = idx.keyToCanonical.get(normKey);
      if (!canonical) {
        const compactKey = normKey.replace(/\s+/g, '');
        canonical = findByCompactKey(idx, compactKey);
      }
      if (canonical && canonical.toLowerCase() !== currentLower) return canonical;
    }
  }
  if (domain) {
    const direct = idx.domainToCompany.get(domain);
    if (direct) return direct;
    const brand = brandFromDomain(domain);
    if (brand) {
      const brandKey = brand.toLowerCase().replace(/[^a-z0-9]/g, '');
      const hit = findByCompactKey(idx, brandKey);
      if (hit) return hit;
    }
  }
  return '';
}
