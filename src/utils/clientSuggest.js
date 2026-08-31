// Ranking for the predictive-text pickers that search company /
// client names (the Deals tab's "Mapped to Client" cell, for one).
//
// A plain `includes` filter puts "Northern Star Waste" above "Star
// Energy" when you type "star", which reads as broken when the thing
// you want is right there. So matches are ranked: exact, then
// whole-string prefix, then word-start prefix, then anywhere. Ties
// break on the shorter name first, then the caller's original order
// (the option lists are already sorted alphabetically).

// Loose comparison key: case- and punctuation-insensitive, so typing
// "acme energy" finds "ACME Energy, LLC" and "at&t" finds "AT&T".
export function normSuggest(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RANK_EXACT = 0;
const RANK_PREFIX = 1;
const RANK_WORD = 2;
const RANK_ANYWHERE = 3;

// Rank one term against one already-normalized candidate. Returns null
// when the term doesn't appear at all.
function termRank(hay, words, term) {
  if (hay === term) return RANK_EXACT;
  if (hay.startsWith(term)) return RANK_PREFIX;
  if (words.some(w => w.startsWith(term))) return RANK_WORD;
  if (hay.includes(term)) return RANK_ANYWHERE;
  return null;
}

// Filter + rank `options` for `query`. Every whitespace-separated term
// in the query has to match somewhere in the candidate, so "star tex"
// narrows to "Lone Star Texas" without needing the words adjacent. An
// empty query returns the head of the list unchanged, which is what
// makes the picker usable as a plain browse-the-list dropdown too.
export function suggestClients(options, query, { limit = 50 } = {}) {
  const list = Array.isArray(options) ? options : [];
  const q = normSuggest(query);
  if (!q) return list.slice(0, limit);
  const terms = q.split(' ');
  const hits = [];
  for (let i = 0; i < list.length; i++) {
    const name = list[i];
    const hay = normSuggest(name);
    if (!hay) continue;
    const words = hay.split(' ');
    let rank = RANK_EXACT;
    let matched = true;
    for (const term of terms) {
      const r = termRank(hay, words, term);
      if (r === null) { matched = false; break; }
      if (r > rank) rank = r;
    }
    if (!matched) continue;
    hits.push({ name, rank, len: hay.length, i });
  }
  hits.sort((a, b) => a.rank - b.rank || a.len - b.len || a.i - b.i);
  return hits.slice(0, limit).map(h => h.name);
}

// The option a typed string unambiguously names, or ''. Used to commit
// what the user typed when they tab/click away without picking a row:
// an exact (loose) match is their pick, anything else isn't.
export function exactClientMatch(options, text) {
  const q = normSuggest(text);
  if (!q) return '';
  for (const name of (Array.isArray(options) ? options : [])) {
    if (normSuggest(name) === q) return name;
  }
  return '';
}
