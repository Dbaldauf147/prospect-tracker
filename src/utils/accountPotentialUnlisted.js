// Where a service went, when Account Potential has no row for it.
//
// Three rules take services off that table, all of them deliberate and all
// of them silent:
//
//   hidden    a service hidden on the Services tab never reaches the page
//             at all - it is out of the Scope picker, so it cannot be in a
//             deal, so nothing prices it
//   decided   sold, in flight, not sold or N/A is not whitespace, and the
//             page is a list of whitespace
//   bundled   a service another one drags in behind it is counted inside
//             that one's row, because two rows would count it twice
//
// Each is right on its own and the three together produce the same question
// over and over: somebody looks for Bill payment, does not find it, and asks
// whether the page has dropped it. The search box was taught to match a
// bundled service through its lead, which puts a row on screen - but the row
// is named after the lead, so it reads as the wrong answer rather than as
// the right one.
//
// So when the search names a service the table has no row for, the page says
// where it went. One line, in the words of whichever rule took it.
//
// Pure: a term and the page's own lists in, sentences out
// (scripts/accountPotentialUnlisted.test.mjs).

import { searchable } from './accountPotentialSearch.js';

const key = (s) => String(s ?? '').trim().toLowerCase();

/**
 * The services a search term names that the table is not showing, and why.
 *
 * Matched the way the table's own search matches, so a term that pulls up
 * nothing and a term that pulls up an explanation agree about what it means.
 * A single character matches half the catalogue, so nothing is offered until
 * the term is long enough to be somebody looking for a particular service.
 *
 *   [{ name, reason: 'hidden' | 'decided' | 'bundled', status, fromOpp, lead }]
 *
 * Capped, with the count of what the cap left out, because the answer to
 * "where is Bill payment" is one line and a list of forty is a second
 * problem rather than an answer to the first.
 */
export function unlistedMatches({
  term,
  visibleNames = [],
  hidden = [],
  decided = [],
  bundles = [],
  limit = 3,
  minTermLength = 3,
} = {}) {
  const t = searchable(String(term ?? '').trim());
  if (t.length < minTermLength) return { entries: [], more: 0 };
  const shown = new Set(visibleNames.map(key));
  const hits = [];
  const seen = new Set();
  const add = (name, rest) => {
    const k = key(name);
    // A row on screen is its own answer. So is a service already explained:
    // the first rule that took it is the one that took it.
    if (!k || shown.has(k) || seen.has(k)) return;
    if (!searchable(name).includes(t)) return;
    seen.add(k);
    hits.push({ name, ...rest });
  };
  for (const name of hidden) add(name, { reason: 'hidden', status: '', fromOpp: false, lead: '' });
  for (const d of decided) {
    add(d?.name, {
      reason: 'decided',
      status: String(d?.status || '').trim(),
      fromOpp: !!d?.fromOpp,
      lead: '',
    });
  }
  for (const b of bundles) {
    for (const a of (b?.adds || [])) {
      if (!a?.open) continue;
      add(a.name, { reason: 'bundled', status: '', fromOpp: false, lead: String(b?.lead?.name || '') });
    }
  }
  return { entries: hits.slice(0, limit), more: Math.max(0, hits.length - limit) };
}

/**
 * One of those, said in words.
 *
 * Each sentence names the rule that took the service AND where to go about
 * it, because "not shown" on its own is the state somebody is already in.
 * A decided service says which record is holding the status: an opp's stage
 * and a status typed on the company card are undone in different places.
 */
export function describeUnlisted(entry, company = '') {
  if (!entry?.name) return '';
  const who = String(company || '').trim();
  if (entry.reason === 'hidden') {
    return `${entry.name} is hidden on the Services tab, so nothing here prices it.`;
  }
  if (entry.reason === 'decided') {
    const status = entry.status || 'decided';
    const where = entry.fromOpp
      ? `an opp has it at ${status}`
      : `the company card has it as ${status}`;
    return who
      ? `${entry.name} is not whitespace on ${who}: ${where}.`
      : `${entry.name} is not whitespace here: ${where}.`;
  }
  if (entry.reason === 'bundled') {
    return entry.lead
      ? `${entry.name} comes with ${entry.lead}, so it is priced inside that row.`
      : `${entry.name} comes with another service, so it is priced inside that row.`;
  }
  return '';
}
