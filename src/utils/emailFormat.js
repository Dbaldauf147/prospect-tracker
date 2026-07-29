// Email-format inference — used by the Changed Jobs tab so that once a
// contact who left their old employer is mapped to a NEW company, we can
// guess their new work email from that company's known address format.
//
// There is no explicit "email format" field anywhere in the data, so we
// learn each company's format from the HubSpot contacts we already have
// at that company: if John Smith is john.smith@acme.com and Jane Doe is
// jane.doe@acme.com, Acme's format is `{first}.{last}@acme.com`, and a
// changed-jobs contact now at Acme gets a predicted address built from
// that pattern.
//
// All exports are pure — no React, no DOM. Build the index once per
// (prospects, contacts) change and reuse it for every lookup.

import { normalizeCompanyKey, FREE_MAIL_DOMAINS, brandFromDomain } from './companyGuess';

// Reduce a name part to bare letters/digits: lowercase, strip accents,
// drop spaces, apostrophes, hyphens, etc. "O'Brien" → "obrien",
// "Van Damme" → "vandamme". Returns '' when nothing usable is left.
function normNamePart(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

// The address formats we recognise, in priority order. `build` turns a
// normalized (first, last) pair into the local part (before the @).
// Priority only matters when two patterns would produce the same string
// for a given sample (rare) — the earlier one wins the inference.
export const EMAIL_PATTERNS = [
  { id: 'first.last',  label: 'first.last',  build: (f, l) => `${f}.${l}` },
  { id: 'first_last',  label: 'first_last',  build: (f, l) => `${f}_${l}` },
  { id: 'first-last',  label: 'first-last',  build: (f, l) => `${f}-${l}` },
  { id: 'firstlast',   label: 'firstlast',   build: (f, l) => `${f}${l}` },
  { id: 'f.last',      label: 'f.last',      build: (f, l) => `${f[0]}.${l}` },
  { id: 'flast',       label: 'flast',       build: (f, l) => `${f[0]}${l}` },
  { id: 'f_last',      label: 'f_last',      build: (f, l) => `${f[0]}_${l}` },
  { id: 'firstl',      label: 'firstl',      build: (f, l) => `${f}${l[0]}` },
  { id: 'first.l',     label: 'first.l',     build: (f, l) => `${f}.${l[0]}` },
  { id: 'last.first',  label: 'last.first',  build: (f, l) => `${l}.${f}` },
  { id: 'lastfirst',   label: 'lastfirst',   build: (f, l) => `${l}${f}` },
  { id: 'lastf',       label: 'lastf',       build: (f, l) => `${l}${f[0]}` },
  { id: 'first',       label: 'first',       build: (f) => `${f}` },
  { id: 'last',        label: 'last',        build: (_f, l) => `${l}` },
];

const PATTERN_BY_ID = new Map(EMAIL_PATTERNS.map((p) => [p.id, p]));

// Split an email into a normalized local part and domain. Returns null
// for anything that isn't a plausible corporate address (no @, free-mail
// provider, or empty pieces).
function splitEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  const at = e.lastIndexOf('@');
  if (at <= 0) return null;
  const local = e.slice(0, at).trim();
  const domain = e.slice(at + 1).trim();
  if (!local || !domain || FREE_MAIL_DOMAINS.has(domain)) return null;
  return { local, domain };
}

// Which of EMAIL_PATTERNS reproduces `local` from this (first, last)?
// Returns the pattern id or '' when none matches. Single-token patterns
// (first / last on their own) are only credited when they don't also
// coincide with a more specific two-token pattern, since priority order
// already puts the specific ones first.
function inferPatternId(first, last, local) {
  const f = normNamePart(first);
  const l = normNamePart(last);
  if (!f || !l || !local) return '';
  for (const p of EMAIL_PATTERNS) {
    // Skip the lone first/last patterns during learning — they match far
    // too eagerly (any john@ would "teach" the `first` format) and would
    // drown out the real two-part pattern. We still keep them available
    // for building predictions if a company genuinely only ever votes one.
    if (p.id === 'first' || p.id === 'last') continue;
    let candidate;
    try { candidate = p.build(f, l); } catch { continue; }
    if (candidate && candidate === local) return p.id;
  }
  // Fall back to the single-token formats only if the whole local part is
  // exactly the first or last name.
  if (local === f) return 'first';
  if (local === l) return 'last';
  return '';
}

// Extract the domain for a prospect from its manual emailDomain entries
// and website hostname (mirrors collectProspectDomains in the contacts
// view). Returns the first usable non-free domain, or ''.
function prospectDomain(p) {
  if (!p) return '';
  if (p.emailDomain) {
    for (const entry of String(p.emailDomain).split(/[\n;,]+/).map((s) => s.trim()).filter(Boolean)) {
      const at = entry.lastIndexOf('@');
      const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
      if (d && !FREE_MAIL_DOMAINS.has(d)) return d;
    }
  }
  if (p.website) {
    const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
    if (d && !FREE_MAIL_DOMAINS.has(d)) return d;
  }
  return '';
}

// Build the format index off the Table View prospects and the HubSpot
// contacts cache. Returns:
//   companyToDomain  Map<normalizedCompanyKey, domain>
//   domainToFormat   Map<domain, { patternId, sample, votes, total }>
//   companyDisplay   Map<normalizedCompanyKey, prettyName>
//   companiesWithFormat  string[] of pretty company names we can predict
export function buildEmailFormatIndex(prospects = [], contacts = []) {
  const companyToDomain = new Map();
  const companyDisplay = new Map();
  // Vote tallies per domain: patternId → count, plus a remembered sample
  // email for each winning pattern so the UI can show provenance.
  const domainVotes = new Map(); // domain → Map<patternId, count>
  const domainSample = new Map(); // domain → Map<patternId, sampleEmail>
  const domainTotal = new Map(); // domain → number of contacts that voted

  const rememberCompany = (name, domain) => {
    const key = normalizeCompanyKey(name);
    if (!key) return;
    if (!companyDisplay.has(key)) companyDisplay.set(key, String(name).trim());
    if (domain && !companyToDomain.has(key)) companyToDomain.set(key, domain);
  };

  // Prospects give us authoritative company → domain mappings.
  for (const p of prospects || []) {
    if (!p?.company) continue;
    rememberCompany(p.company, prospectDomain(p));
  }

  // Contacts give us both company → domain (when a prospect didn't) and
  // the per-domain format votes.
  for (const c of contacts || []) {
    const parts = splitEmail(c?.email);
    if (c?.company && parts) rememberCompany(c.company, parts.domain);
    else if (c?.company) rememberCompany(c.company, '');
    if (!parts) continue;
    const patternId = inferPatternId(c?.firstname, c?.lastname, parts.local);
    domainTotal.set(parts.domain, (domainTotal.get(parts.domain) || 0) + 1);
    if (!patternId) continue;
    if (!domainVotes.has(parts.domain)) { domainVotes.set(parts.domain, new Map()); domainSample.set(parts.domain, new Map()); }
    const votes = domainVotes.get(parts.domain);
    votes.set(patternId, (votes.get(patternId) || 0) + 1);
    const samples = domainSample.get(parts.domain);
    if (!samples.has(patternId)) samples.set(patternId, String(c.email).toLowerCase().trim());
  }

  const domainToFormat = new Map();
  for (const [domain, votes] of domainVotes) {
    let bestId = '';
    let best = 0;
    for (const [id, n] of votes) {
      if (n > best) { best = n; bestId = id; }
    }
    if (!bestId) continue;
    domainToFormat.set(domain, {
      patternId: bestId,
      sample: domainSample.get(domain)?.get(bestId) || '',
      votes: best,
      total: domainTotal.get(domain) || best,
    });
  }

  // Pretty list of companies we can actually predict for — a company is
  // predictable when it resolves to a domain that has a learned format.
  const predictable = [];
  const seen = new Set();
  for (const [key, domain] of companyToDomain) {
    if (!domainToFormat.has(domain)) continue;
    const name = companyDisplay.get(key);
    if (!name) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    predictable.push(name);
  }
  predictable.sort((a, b) => a.localeCompare(b));

  return { companyToDomain, domainToFormat, companyDisplay, companiesWithFormat: predictable };
}

// Resolve the domain we'd use for a mapped company name. Tries the exact
// normalized key first, then a brand probe against known domains (so a
// typed "Acme" still lands on acme.com when a prospect/contact taught it).
function resolveDomain(company, index) {
  const key = normalizeCompanyKey(company);
  if (!key) return '';
  const direct = index.companyToDomain.get(key);
  if (direct) return direct;
  // Brand fallback: if the typed company's compact key matches a known
  // domain's brand (acme ↔ acme.com), reuse that domain.
  const compact = key.replace(/\s+/g, '');
  for (const [dom, fmt] of index.domainToFormat) {
    void fmt;
    if (brandFromDomain(dom).toLowerCase().replace(/[^a-z0-9]/g, '') === compact) return dom;
  }
  return '';
}

// Predict a work email for a contact at a mapped company. Returns a
// status-tagged result so the UI can distinguish the different "we
// couldn't" cases from a confident prediction:
//   { status: 'ok', email, domain, patternId, label, sample, votes, total }
//   { status: 'no-company' }  — nothing typed yet
//   { status: 'no-domain', company }  — company not resolvable to a domain
//   { status: 'no-format', domain }   — domain known but no learned format
//   { status: 'no-name' }     — missing first/last name to build from
export function predictEmailForContact({ firstname, lastname, company } = {}, index) {
  if (!index) return { status: 'no-company' };
  const typed = String(company || '').trim();
  if (!typed) return { status: 'no-company' };
  const domain = resolveDomain(typed, index);
  if (!domain) return { status: 'no-domain', company: typed };
  const fmt = index.domainToFormat.get(domain);
  if (!fmt) return { status: 'no-format', domain };
  const f = normNamePart(firstname);
  const l = normNamePart(lastname);
  const pattern = PATTERN_BY_ID.get(fmt.patternId);
  if (!pattern) return { status: 'no-format', domain };
  // Two-token patterns need both names; single-token ones need only theirs.
  const needsFirst = fmt.patternId !== 'last';
  const needsLast = fmt.patternId !== 'first';
  if ((needsFirst && !f) || (needsLast && !l)) return { status: 'no-name', domain };
  let local;
  try { local = pattern.build(f, l); } catch { return { status: 'no-name', domain }; }
  if (!local) return { status: 'no-name', domain };
  return {
    status: 'ok',
    email: `${local}@${domain}`,
    domain,
    patternId: fmt.patternId,
    label: pattern.label,
    sample: fmt.sample,
    votes: fmt.votes,
    total: fmt.total,
  };
}
