// Which contacts a Titles-page search actually pulls, for the popup that
// opens from a search's name.
//
// The page was a reference: the searches were run by hand in HubSpot and
// this just said what to type. The popup runs one against the contacts
// already in the app, so a search can be checked by looking at who it
// catches, and who its Not terms throw back.
//
// The rules:
//
//   - a title matches a term when the term appears in it as whole words,
//     any case, with an optional plural "s" ("Director" finds "Directors",
//     "Intern" does not find "International", "Tax" does not find
//     "Taxonomy"). A Not term like "Intern" written for interns would
//     otherwise knock out every International VP.
//   - in: the title matches at least one include term (any include group).
//   - out: the title matches any Not term, the search's own Not groups or
//     the general Not list that rides along on every search.
//   - Hidden, Left and Schneider contacts are never listed, the same
//     exclusion every roster runs (isMappableContact).
//
// Pure: contacts and a search in, rows out (scripts/titleSearchMatch.test.mjs).

import { isMappableContact } from './decisionMakerCoverage.js';

// Same cleanup the Decision Maker titles use: a mangled non-breaking space
// (U+FFFD) reads as a space.
const clean = (s) => String(s || '').replace(/�/g, ' ').replace(/\s+/g, ' ').trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A term as a whole-word pattern. Punctuation at either end ("Power?") is
// dropped, since it is the author's note rather than part of a title, and
// runs of spaces inside match any spacing. Returns null for a term with no
// letters or digits left.
export function termPattern(term) {
  const core = clean(term).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!core) return null;
  const body = core.split(' ').map(escapeRe).join('\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${body}(?:s|es)?(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

function compile(terms) {
  const seen = new Set();
  const out = [];
  for (const t of terms || []) {
    const label = clean(t);
    const k = label.toLowerCase();
    if (!label || seen.has(k)) continue;
    seen.add(k);
    const re = termPattern(label);
    if (re) out.push({ label, re });
  }
  return out;
}

/** The search's include and Not terms, general Not list folded into the Not side. */
export function searchTermSets(entry, generalNot = []) {
  const include = [];
  const exclude = [];
  for (const g of entry?.groups || []) {
    (g?.kind === 'exclude' ? exclude : include).push(...(g?.terms || []));
  }
  return { include: compile(include), exclude: compile([...exclude, ...(generalNot || [])]) };
}

const hitsOf = (title, set) => set.filter(t => t.re.test(title)).map(t => t.label);

/**
 * Run one search over the contacts.
 *
 * Returns { matched, excluded, includeCount, excludeCount }: `matched` are
 * the contacts the search pulls, `excluded` the ones a title term caught
 * but a Not term threw back. Each row is { contact, title, hits, notHits }.
 */
export function matchTitleSearch(contacts, entry, generalNot = []) {
  const { include, exclude } = searchTermSets(entry, generalNot);
  const matched = [];
  const excluded = [];
  if (include.length) {
    for (const c of contacts || []) {
      if (!isMappableContact(c)) continue;
      const title = clean(c?.jobtitle);
      if (!title) continue;
      const hits = hitsOf(title, include);
      if (!hits.length) continue;
      const notHits = hitsOf(title, exclude);
      (notHits.length ? excluded : matched).push({ contact: c, title, hits, notHits });
    }
  }
  return { matched, excluded, includeCount: include.length, excludeCount: exclude.length };
}
