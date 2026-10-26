// Which contacts belong on a company's roster: the rule the company card's
// Contacts tab runs, lifted out of ProspectModal so other pages that offer
// "the people at this company" (the Events Name picker) list the same
// people the card does. Pure, so scripts/companyRoster.test.mjs can run it
// without a browser.
//
// A contact is on the roster when its HubSpot Company text matches the
// company (fuzzy, respecting a division bracket), or, with a blank Company,
// when its email sits on one of the company's domains. Contacts linked to
// the company by hand always are, ones removed from it never are, and
// hide-tagged ones only with showHidden. The company's "Exact contact
// match" box narrows the name match to the exact name and turns off the
// domain match.

import { withoutParenNotes, parenAliases, carriesDivision } from './companyIndex.js';

// A company name for an exact comparison: accents, case, punctuation and
// spacing don't count, the words (brackets included) do. "Brookfield
// (Maymont Homes)" equals "brookfield maymont homes" and not "Brookfield".
export function exactCompanyKey(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function companiesMatch(a, b) {
  const fullA = (a || '').toLowerCase().trim();
  const fullB = (b || '').toLowerCase().trim();
  if (!fullA || !fullB) return false;
  if (fullA === fullB) return true;
  // The fuzzy checks below read the names without their bracketed notes:
  // "Rehlko (a Platinum Equity Co.)" contains "Platinum Equity" only in a
  // note about its owner, and matching on it put every Platinum Equity opp
  // on Rehlko's card. One-word brackets ("(JLL)") are still matched as
  // aliases at the end.
  const na = withoutParenNotes(fullA);
  const nb = withoutParenNotes(fullB);
  // Ultra-tolerant equality. Normalizes Unicode (NFKD), drops
  // diacritics, replaces every non-letter/digit with a single
  // space, collapses whitespace, then compares. Catches the case
  // where one side has a non-breaking space, smart-quote paren,
  // or different punctuation that breaks ===.
  const flatten = (s) => String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const fa = flatten(na);
  const fb = flatten(nb);
  if (fa && fb && fa === fb) return true;
  // Equality still counts with the brackets in: "Acme (US)" is "Acme US".
  if (flatten(fullA) === flatten(fullB)) return true;
  // Whitespace-collapsed equality on the original lower-trimmed
  // strings — catches copy/paste variants with double spaces.
  const squish = (s) => s.replace(/\s+/g, ' ').trim();
  if (squish(na) === squish(nb)) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  // Acronym / single-token match. Catches "TIAA" vs
  // "(TIAA) Teachers Insurance and Annuity Association of America"
  // and "JLL" vs "Jones Lang LaSalle (JLL)": a one-word bracket is
  // an alias (parenAliases), a longer one is a note and doesn't count.
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    const longerFull = na.length >= nb.length ? fullA : fullB;
    if ([...tokensOf(longer), ...parenAliases(longerFull)].includes(sTokens[0])) return true;
  }
  return false;
}


const FREE_DOMAINS = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com']);

// The company's registered email domains: its Email Domain entries (bare
// domains or whole addresses, newline / comma / semicolon separated) and
// its website's host.
export function companyEmailDomains({ emailDomain = '', website = '' } = {}) {
  const domains = new Set();
  for (const entry of String(emailDomain || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
    const at = entry.lastIndexOf('@');
    const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
    if (d) domains.add(d);
  }
  if (website) {
    const d = String(website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
    if (d) domains.add(d);
  }
  return domains;
}

function contactDomain(email) {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  const d = email.slice(at + 1).toLowerCase().trim();
  return (d && !FREE_DOMAINS.has(d)) ? d : '';
}

const idOf = (c) => String(c?.id || c?.vid || '');

//   company     { company, emailDomain, website, exactContactMatch }, the
//               prospect's own fields
//   showHidden  the card's "Show hidden" toggle
//   isHidden    the Hide-tag test (contactTags.contactIsHidden)
//   links       settings.companyContactLinks  { companyLower: [id, ...] }
//   exclusions  settings.companyContactExclusions, same shape
export function companyRosterContacts(contacts, company, {
  showHidden = false, isHidden = () => false, links = {}, exclusions = {},
} = {}) {
  const name = String(company?.company || '').trim();
  if (!name || !contacts?.length) return [];
  const domains = companyEmailDomains(company);
  const exactKey = company.exactContactMatch === true ? exactCompanyKey(name) : '';
  const matched = contacts.filter(c => {
    // The "Show hidden" toggle flips this gate off so hide-tagged people
    // resurface - the user can then click into them to clear the tag.
    if (!showHidden && isHidden(c)) return false;
    // Exact-name mode: the Company text has to be this name, and nothing
    // else (fuzzy name, shared domain) gets a contact in. Linked contacts
    // below still come through: a link is the user saying so directly.
    if (exactKey) return exactCompanyKey(c.company) === exactKey;
    // A company named for one division of a bigger one, "Brookfield (Self
    // Storage)", only takes contacts whose Company names that division too.
    // The fuzzy match drops the bracket, and then every "Brookfield" and
    // "Brookfield Asset Management" contact (the parent's people) landed
    // here. Link the odd exception.
    if (companiesMatch(c.company, name)) return carriesDivision(c.company, name);
    // Domain match only fills in contacts whose own Company text is blank.
    // A shared parent domain (e.g. blackstone.com) otherwise drags every
    // portfolio company's people onto each entity's roster - a contact whose
    // Company already reads "Blackstone" shouldn't surface under "BRE Hotels
    // & Resorts". Contacts that genuinely belong here but carry a mismatched
    // Company text can still be pinned via a link.
    const d = contactDomain(c.email);
    return !!d && domains.has(d) && !(c.company || '').trim();
  });
  // Explicitly linked contacts always appear (subject to the hidden toggle),
  // even when their Company text / email domain doesn't match, so linking an
  // existing contact sticks without a HubSpot refresh.
  const key = name.toLowerCase();
  const linkList = links?.[key] || [];
  if (linkList.length) {
    const present = new Set(matched.map(idOf));
    const linkSet = new Set(linkList.map(String));
    for (const c of contacts) {
      const id = idOf(c);
      if (!id || present.has(id) || !linkSet.has(id)) continue;
      if (!showHidden && isHidden(c)) continue;
      matched.push(c);
      present.add(id);
    }
  }
  // Per-company exclusions: ids removed from this company's roster without
  // deleting them from HubSpot, so a shared-domain or fuzzy-name false
  // positive stays gone across syncs. The "Show hidden" toggle brings them
  // back so the user can re-add them.
  const exIds = new Set((exclusions?.[key] || []).map(String));
  if (exIds.size) {
    if (!showHidden) return matched.filter(c => !exIds.has(idOf(c)));
    const present = new Set(matched.map(idOf));
    for (const c of contacts) {
      const id = idOf(c);
      if (id && exIds.has(id) && !present.has(id)) { matched.push(c); present.add(id); }
    }
  }
  return matched;
}
