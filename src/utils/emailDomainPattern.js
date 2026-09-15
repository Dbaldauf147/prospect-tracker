// A company's email naming convention, learned from the people we already
// have at it.
//
// The Email Domains field on a company record holds one or more
// "<pattern>@<domain>" entries - "firstinitiallastname@coatue.com" - where
// the pattern half is one of EMAIL_PATTERN_RULES below. That one field is
// what lets the app guess an address for somebody whose email nobody has:
// the Bulk Add page fills a name-only paste from it, and the company card
// offers to work it out from the contacts already on the account.
//
// Both of those used to carry their own copy of the vocabulary. One copy
// now, because a pattern key written by one page and read by the other has
// to be the same string, and "firstname.lastname" against "first.last" is a
// field that silently stops working.
//
// Pure, so the guessing can be pinned without a browser
// (scripts/emailDomainPattern.test.mjs).

import { FREE_MAIL_DOMAINS } from './companyGuess.js';

// Patterns a contact's local part is checked against, in priority order:
// where two would produce the same string, the first wins. The keys are
// data - they are what sits in the Email Domains field on hundreds of
// company records - so they are renamed at the cost of a migration.
export const EMAIL_PATTERN_RULES = [
  { key: 'firstname.lastname',    build: (f, l) => (f && l ? `${f}.${l}` : null) },
  { key: 'firstname_lastname',    build: (f, l) => (f && l ? `${f}_${l}` : null) },
  { key: 'firstname-lastname',    build: (f, l) => (f && l ? `${f}-${l}` : null) },
  { key: 'firstnamelastname',     build: (f, l) => (f && l ? `${f}${l}` : null) },
  { key: 'lastname.firstname',    build: (f, l) => (f && l ? `${l}.${f}` : null) },
  { key: 'lastnamefirstname',     build: (f, l) => (f && l ? `${l}${f}` : null) },
  { key: 'firstinitial.lastname', build: (f, l) => (f && l ? `${f[0]}.${l}` : null) },
  { key: 'firstinitiallastname',  build: (f, l) => (f && l ? `${f[0]}${l}` : null) },
  { key: 'firstname.lastinitial', build: (f, l) => (f && l ? `${f}.${l[0]}` : null) },
  { key: 'firstnamelastinitial',  build: (f, l) => (f && l ? `${f}${l[0]}` : null) },
  { key: 'firstname',             build: (f)    => (f ? f : null) },
  { key: 'lastname',              build: (_, l) => (l ? l : null) },
];

const namePart = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/** The domain half of an address, lowercased, or '' when there isn't one. */
export function domainOf(email) {
  const e = String(email || '').toLowerCase().trim();
  const at = e.lastIndexOf('@');
  if (at <= 0) return '';
  return e.slice(at + 1).trim();
}

/**
 * Which pattern this address follows for this person, or null.
 *
 * A "+tag" suffix is dropped first: john.smith+crm@acme.com is the same
 * convention as john.smith@acme.com, and counting it as no pattern would
 * hold a company's convention hostage to one person's filing habit.
 */
export function detectLocalPattern(email, firstname, lastname) {
  if (!email) return null;
  const at = String(email).lastIndexOf('@');
  if (at <= 0) return null;
  const local = String(email).slice(0, at).toLowerCase().replace(/\+.*/, '');
  const f = namePart(firstname);
  const l = namePart(lastname);
  for (const rule of EMAIL_PATTERN_RULES) {
    const expected = rule.build(f, l);
    if (expected && local === expected) return rule.key;
  }
  return null;
}

/**
 * Materialise an address from a company's recorded Email Domains field.
 *
 * Returns '' when no usable pattern is on record - a bare domain with no
 * naming pattern, an unrecognised pattern, or a name it cannot be filled
 * with. A guess nobody can build is better said as nothing than as a
 * half-built address somebody might send to.
 */
export function buildEmailFromPattern(emailDomainField, firstname, lastname) {
  const f = namePart(firstname);
  const l = namePart(lastname);
  if (!f && !l) return '';
  const entries = String(emailDomainField || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const at = entry.lastIndexOf('@');
    if (at <= 0) continue; // bare domain, no naming pattern recorded
    const patternKey = entry.slice(0, at).toLowerCase();
    const domain = entry.slice(at + 1).toLowerCase();
    if (!domain) continue;
    const rule = EMAIL_PATTERN_RULES.find(r => r.key === patternKey);
    if (!rule) continue;
    const local = rule.build(f, l);
    if (local) return `${local}@${domain}`;
  }
  return '';
}

/**
 * What a set of contacts says this company's Email Domains entry should be.
 *
 * The busiest work domain wins, and then the commonest naming pattern
 * AMONG THE PEOPLE ON THAT DOMAIN - counting patterns across every domain
 * at once would let a handful of people at a parent company decide the
 * convention for a subsidiary that spells its addresses differently.
 *
 * Free-mail addresses are ignored: a contact who gave us a gmail address
 * says nothing about how their employer builds addresses.
 *
 * Always returns an object, so a caller can say WHY there is nothing to
 * offer rather than showing a dead button:
 *
 *   { entry, domain, patternKey, votes, domainCount, total, sample, reason }
 *
 * `entry` is null unless a domain and a pattern both won, and `reason` is
 * then one of 'no-contacts' (nobody to learn from), 'no-work-emails' (only
 * free-mail or malformed addresses) or 'no-pattern' (a domain, but no
 * convention any two people agree on).
 */
export function estimateEmailDomain(contacts = []) {
  const empty = {
    entry: null, domain: '', patternKey: '', votes: 0, domainCount: 0, total: 0, sample: '',
  };
  const byDomain = new Map();
  let total = 0;
  for (const c of contacts || []) {
    const email = String(c?.email || '').toLowerCase().trim();
    const domain = domainOf(email);
    if (!domain || FREE_MAIL_DOMAINS.has(domain)) continue;
    total += 1;
    if (!byDomain.has(domain)) byDomain.set(domain, { count: 0, patterns: new Map(), samples: new Map() });
    const bucket = byDomain.get(domain);
    bucket.count += 1;
    const pattern = detectLocalPattern(email, c?.firstname, c?.lastname);
    if (!pattern) continue;
    bucket.patterns.set(pattern, (bucket.patterns.get(pattern) || 0) + 1);
    if (!bucket.samples.has(pattern)) bucket.samples.set(pattern, email);
  }
  if (total === 0) {
    return { ...empty, reason: (contacts || []).length === 0 ? 'no-contacts' : 'no-work-emails' };
  }

  // The busiest domain, with the name breaking a tie so the same book of
  // contacts always estimates the same way.
  let domain = '';
  let domainCount = 0;
  for (const [d, bucket] of byDomain) {
    if (bucket.count > domainCount || (bucket.count === domainCount && d < domain)) {
      domain = d;
      domainCount = bucket.count;
    }
  }
  const bucket = byDomain.get(domain);
  let patternKey = '';
  let votes = 0;
  for (const rule of EMAIL_PATTERN_RULES) {
    const n = bucket.patterns.get(rule.key) || 0;
    // Ties go to the earlier rule, which is the more specific one - the
    // same order detectLocalPattern reads them in.
    if (n > votes) { patternKey = rule.key; votes = n; }
  }
  if (!patternKey) {
    return { ...empty, domain, domainCount, total, reason: 'no-pattern' };
  }
  return {
    entry: `${patternKey}@${domain}`,
    domain,
    patternKey,
    votes,
    domainCount,
    total,
    sample: bucket.samples.get(patternKey) || '',
    reason: '',
  };
}
