import { companiesMatch } from './listFlags';

// Table View companies matching `query`, best first, at most `limit`.
// Ranked: a fuzzy company match on the full query first (the usual reason a
// row didn't link is "Triumph" vs "Triumph Group"), then a name that starts
// with it, then one that contains it, then one that contains every word of
// it. Shared by the link dialog and the Portfolio Companies add search.
export function rankTableViewCompanies(prospects, query, limit = 12) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const p of prospects || []) {
    const name = String(p?.company || '').trim();
    if (!name || !p.id) continue;
    const lower = name.toLowerCase();
    let score = 99;
    if (companiesMatch(name, q)) score = 0;
    else if (lower.startsWith(q)) score = 1;
    else if (lower.includes(q)) score = 2;
    else if (words.every(w => lower.includes(w))) score = 3;
    if (score < 99) scored.push({ p, score, name });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(s => s.p);
}
