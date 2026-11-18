// Helpers for the Targets tab's "Search web" menu: turn the company record
// into the {name} and {domain} the searches in config/targetWebSearches use,
// and build the links. Pure functions, no network: the menu only opens links.
import { TARGET_WEB_SEARCHES } from '../config/targetWebSearches.js';

// Legal suffixes dropped from the end of a name, compared lowercased with
// dots removed (so "Inc." / "Inc", "S.A." / "SA", "N.V." / "NV" all match).
const LEGAL_SUFFIXES = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'plc', 'lp', 'sa', 'ag', 'nv', 'co']);
// Trailing punctuation (and a dangling "&" from "Smith & Co.") left behind.
const TRAILING = /[\s,.;:&\-–]+$/u;

// "Prologis, Inc." -> "Prologis"; "Foo Co., Ltd." -> "Foo";
// "Jones Lang LaSalle (JLL)" -> "Jones Lang LaSalle" (a trailing bracketed
// alias would break the exact-phrase search). Double quotes inside the name
// are dropped since the name is wrapped in them. A name that is nothing but
// a suffix ("Corp") is kept rather than emptied.
export function cleanSearchName(raw) {
  let name = String(raw ?? '').replace(/"/g, '').replace(/\s+/g, ' ').trim();
  name = name.replace(/\s*\([^()]*\)\s*$/, '').trim() || name;
  for (;;) {
    const trimmed = name.replace(TRAILING, '');
    const words = trimmed.split(' ');
    const last = words[words.length - 1] || '';
    if (words.length > 1 && LEGAL_SUFFIXES.has(last.toLowerCase().replace(/\./g, ''))) {
      name = words.slice(0, -1).join(' ');
      continue;
    }
    name = trimmed;
    break;
  }
  return name || String(raw ?? '').trim();
}

// "https://www.prologis.com/about" -> "prologis.com"; "@tiaa.org" -> "tiaa.org".
// '' when nothing domain-like is there.
export function bareDomain(raw) {
  const host = String(raw ?? '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0]
    .replace(/:\d+$/, '')
    .replace(/^www\d*\./, '')
    .replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}

export function googleSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// The template with {name} (quoted) and {domain} filled in.
export function fillSearchTemplate(template, { name, domain }) {
  return String(template)
    .replace(/\{name\}/g, `"${name}"`)
    .replace(/\{domain\}/g, domain);
}

// The menu's items for a company: [{ label, href } | { divider: true }].
// Searches that need a domain are left out when there is none, and a
// divider never starts or ends the list or doubles up.
export function buildTargetSearchLinks({ company, website, emailDomain } = {}, searches = TARGET_WEB_SEARCHES) {
  const name = cleanSearchName(company);
  if (!name) return [];
  const domain = bareDomain(website) || bareDomain(emailDomain);
  const items = [];
  for (const s of searches) {
    if (s.divider) {
      if (items.length && !items[items.length - 1].divider) items.push({ divider: true });
      continue;
    }
    if (s.requiresDomain && !domain) continue;
    const href = s.url || googleSearchUrl(fillSearchTemplate(s.query, { name, domain }));
    items.push({ label: s.label, href });
  }
  while (items.length && items[items.length - 1].divider) items.pop();
  return items;
}
