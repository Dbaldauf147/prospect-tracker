// Which opportunities belong to a PE firm.
//
// A firm's opps are the ones on the firm's own account plus the ones on any
// of its portfolio companies — the "0/0" the PE Portfolio table prints in
// its PE Opps column, and the same question the Prospecting ladder asks when
// it looks for firms with nothing in flight. This lives here so those two
// can't answer it differently: a firm reading 0 on one page and 2 on the
// other is worse than either number being wrong.
//
// The matcher is deliberately stricter than the general `companiesMatch`
// used for contacts. That one is loose so acronyms and partial names still
// find their people; here looseness over-counts deals — a portfolio company
// called "Origin" would claim an unrelated "Origin Bank" opp — so only an
// exact normalized match, or a full multi-word phrase one account name
// contains verbatim, counts.

import { splitPeOwners } from './peOwners.js';

// Closed/invalid stages from the Opps tab. Closed deals still count as opps
// the firm HAS; invalid ones are spreadsheet debris and count as nothing.
export const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
export const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

const CO_SUFFIX_RE = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|lp|llp|plc|holdings?)\b\.?/gi;

export function normalizeAccount(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(CO_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function accountMatchesCompany(companyName, oppAccount) {
  const a = normalizeAccount(companyName);
  const b = normalizeAccount(oppAccount);
  if (!a || !b) return false;
  if (a === b) return true;
  const aWords = a.split(' ');
  const bWords = b.split(' ');
  const [shortW, longW] = aWords.length <= bWords.length ? [aWords, bWords] : [bWords, aWords];
  // Require the shorter side to be a multi-word phrase appearing verbatim
  // (with word boundaries) inside the longer one. A single shared word is
  // never enough — that's what produced the false-positive opp counts.
  if (shortW.length < 2) return false;
  return (' ' + longW.join(' ') + ' ').includes(' ' + shortW.join(' ') + ' ');
}

/**
 * Every prospect that names a PE firm as its PE Owner, keyed by the
 * lowercased owner name — a firm's portfolio companies as the app actually
 * links them. A prospect can name more than one owner and appears under each.
 */
export function portfolioByPeOwner(prospects) {
  const map = new Map();
  for (const p of (Array.isArray(prospects) ? prospects : [])) {
    for (const owner of splitPeOwners(p?.peOwner)) {
      const key = owner.trim().toLowerCase();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
  }
  return map;
}

/** The account names one firm's opps can land on: the firm, then its PCs. */
export function peFirmAccountNames(firm, portfolio = []) {
  const names = [String(firm || '').trim()];
  for (const p of portfolio) names.push(String(p?.company || '').trim());
  return names.filter(Boolean);
}

/**
 * The opp rows belonging to those account names, debris dropped.
 *
 * Rows rather than a count, because the PE table also lists them in the
 * column's tooltip — one pass, one definition, two readings of it.
 */
export function peFirmOppRows(names, oppsRecords) {
  const wanted = (Array.isArray(names) ? names : []).map(n => String(n || '').trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return [];
  const out = [];
  for (const r of (Array.isArray(oppsRecords) ? oppsRecords : [])) {
    const stage = String(r?.['Stage'] || '').trim();
    if (INVALID_STAGES.has(stage)) continue;
    const acct = String(r?.['Account'] || '').toLowerCase();
    if (!acct) continue;
    if (!wanted.some(n => accountMatchesCompany(n, acct))) continue;
    out.push(r);
  }
  return out;
}

/** Is this opp still open — the "active" half of the PE Opps ratio. */
export function isOppActive(r) {
  return !CLOSED_STAGES.has(String(r?.['Stage'] || '').trim());
}
