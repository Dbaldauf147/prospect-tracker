// The Not lists on the Titles page, read for use as a filter elsewhere.
//
// The Titles page keeps two kinds of Not term: the general list that rules
// a hit out of every search (settings.contactTitleGeneralNot), and the Not
// groups individual searches carry. Bulk Add pulls both in to find the
// queued contacts whose job title one of them names, which are the ones a
// search run by hand would have left out.
import { resolveTitleSearches } from '../data/contactTitleSearches.js';

export const GENERAL_NOT_SOURCE = 'general';

const clean = (list) => {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (typeof t !== 'string') continue;
    const v = t.trim();
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
};

// One entry per Not list that has terms: the general list first, then each
// search with a Not group, in page order. A search's several Not groups
// are one list here, since they rule out the same search.
export function notTitleSources(settings) {
  const out = [];
  const general = clean(settings?.contactTitleGeneralNot);
  if (general.length) out.push({ key: GENERAL_NOT_SOURCE, label: 'Every search', terms: general });
  for (const entry of resolveTitleSearches(settings)) {
    const terms = clean((entry.groups || []).filter(g => g.kind === 'exclude').flatMap(g => g.terms || []));
    if (terms.length) out.push({ key: `search:${entry.key}`, label: entry.name || 'Untitled search', terms });
  }
  return out;
}

// The terms of the chosen lists, de-duplicated. `off` holds the keys of
// the lists switched off, so a list added on the Titles page later is in
// by default.
export function activeNotTerms(sources, off) {
  return clean(sources.filter(s => !off?.has?.(s.key)).flatMap(s => s.terms));
}

// The first term a job title contains, or ''. Contains, not equals, in
// either case: the way the Titles page reads its own Not terms, and the
// way the searches they come from are run.
export function matchedNotTerm(title, terms) {
  const t = String(title || '').toLowerCase();
  if (!t.trim()) return '';
  for (const term of terms) {
    if (t.includes(term.toLowerCase())) return term;
  }
  return '';
}

// Where the terms sit in a job title, as [start, end) ranges in order, with
// overlapping or touching hits merged ("Executive Assistant" and
// "Assistant" are one stretch). Every occurrence of every term, so the
// cell can mark all of what makes the row a match.
export function notTermRanges(title, terms) {
  const text = String(title || '');
  const lower = text.toLowerCase();
  const hits = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + 1)) {
      hits.push([i, i + needle.length]);
    }
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [start, end] of hits) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}
