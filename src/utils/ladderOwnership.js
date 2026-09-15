// Whose work the Prospecting ladder's two list steps are naming.
//
// Steps 6 and 7 both print rows rather than a bare count — the PE partners
// worth ringing for an intro, and the Key contacts a visit hasn't reached
// yet — and both used to list the whole book. A PE firm another CDM owns
// and a Key contact at somebody else's account are not work this user can
// pick up, and an account already written off as "Lost - Not Sold" has
// given its answer, so neither belongs on a ladder whose whole argument is
// "start at the top and work down".
//
// Two rules, one place, because the two steps ask the same question of
// different shapes: step 6 holds the account record itself, step 7 holds a
// HubSpot contact whose Company is free text. isOwnedAccount is the rule;
// makeOwnedContactGate is the rule plus the lookup from a contact back to
// the account behind it.
//
// Imported with the extension so this module also loads under plain Node
// (scripts/ladderOwnership.test.mjs), not just through the bundler.
import { NOT_SOLD_STATUS } from '../data/enums.js';
import { matchesCdm } from './cdmMatch.js';
import { collectClientDomains, FREE_MAIL, rosterCompaniesMatch } from './contactRosters.js';

// The Status that means the account has already said no. It lives beside
// the status list in data/enums.js now, because the PE Portfolio table
// turns on the same value and reading it through this module would have
// dragged the whole ladder in with it. Re-exported so the callers that
// already ask this module for it keep working.
export { NOT_SOLD_STATUS };

/**
 * Is this account one the ladder should be naming: this CDM's, and not
 * already written off?
 *
 * A missing record is not owned. That matters for the contact gate below —
 * a contact whose Company text matches nothing in Table View has no account
 * to be the user's, and guessing that it is theirs is how somebody else's
 * book gets onto this page.
 */
export function isOwnedAccount(prospect, cdmName) {
  if (!prospect) return false;
  if (String(prospect.status || '').trim() === NOT_SOLD_STATUS) return false;
  return matchesCdm(prospect.cdm, cdmName);
}

// The contact's email domain, or '' when there isn't a usable one. Same
// rule the roster gates run: a free-mail address belongs to a person rather
// than an account, so it can never stand in for one.
function accountDomain(contact) {
  const email = String(contact?.email || '').toLowerCase().trim();
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  const domain = email.slice(at + 1).trim();
  return domain && !FREE_MAIL.has(domain) ? domain : '';
}

/**
 * The account behind a HubSpot contact, in the order the rest of the app
 * resolves one: the exact company name first (findProspectByCompany's rule,
 * and the only one that can't land on the wrong account), then the
 * account's own email domains, then the fuzzy name compare the roster gates
 * fall back to for the suffixes and abbreviations HubSpot's Company text is
 * full of.
 *
 * Returns null when nothing matches, which the gate reads as "not this
 * user's" — see isOwnedAccount.
 */
function makeAccountLookup(prospects) {
  const rows = Array.isArray(prospects) ? prospects : [];
  const byName = new Map();
  const byDomain = new Map();
  for (const p of rows) {
    const name = String(p?.company || '').trim().toLowerCase();
    // First record wins on a duplicated name or domain, the way
    // findProspectByCompany reads the book.
    if (name && !byName.has(name)) byName.set(name, p);
    const domains = new Set();
    collectClientDomains(p, domains);
    for (const d of domains) if (!byDomain.has(d)) byDomain.set(d, p);
  }
  return (contact) => {
    const company = String(contact?.company || '').trim();
    if (company) {
      const exact = byName.get(company.toLowerCase());
      if (exact) return exact;
    }
    const domain = accountDomain(contact);
    if (domain) {
      const byMail = byDomain.get(domain);
      if (byMail) return byMail;
    }
    if (!company) return null;
    for (const p of rows) {
      if (rosterCompaniesMatch(p?.company, company)) return p;
    }
    return null;
  };
}

/**
 * A predicate over HubSpot contacts: is this person at an account of this
 * CDM's that hasn't been written off?
 *
 * Built once per prospect list rather than per contact — the fuzzy fallback
 * walks the book, and a visit list of 300 names would otherwise walk it 300
 * times.
 */
export function makeOwnedContactGate(prospects, cdmName) {
  const accountOf = makeAccountLookup(prospects);
  return (contact) => isOwnedAccount(accountOf(contact), cdmName);
}
