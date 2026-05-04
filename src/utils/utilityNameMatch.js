// Fuzzy matcher for utility / supplier names. Pepco MD → "PEPCO
// (Potomac Electric Power Company)" — that kind of thing. The point
// is to be tolerant of branch suffixes ("MD"), corporate suffixes
// ("Inc", "LLC"), and well-known abbreviations (BGE, ConEd, PG&E)
// without leaving real distinct utilities mistakenly matched.
//
// Designed to be reused for other lookups — call findFuzzyMatch with
// any candidate string + array of known names. Tunable via the
// `threshold` option (default 25 on the 0-100 scale).

const STOPWORDS = new Set([
  'the', 'and', 'company', 'companies', 'inc', 'llc', 'corp', 'corporation',
  'co', 'ltd', 'electric', 'electricity', 'power', 'gas', 'natural',
  'energy', 'utility', 'utilities', 'service', 'services', 'group',
  'holdings', 'holding', 'cooperative', 'coop', 'authority', 'commission',
]);

// Two-letter US state / territory codes. Often tagged onto vendor
// names ("Pepco MD", "Dominion VA"). Treat as filler when comparing.
const STATE_CODES = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il',
  'in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt',
  'ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri',
  'sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc','pr',
]);

// Curated list of well-known utility abbreviations and their canonical
// substrings. Each entry: a substring expected somewhere in the
// official utility name (lowercased, alphanumeric only) paired with
// every common abbreviation/alias that should resolve to it.
const ALIASES = [
  { canonicalSubstr: 'consolidatededison', aliases: ['coned', 'conedison', 'consoledison'] },
  { canonicalSubstr: 'baltimoregaselectric', aliases: ['bge'] },
  { canonicalSubstr: 'potomacelectricpower', aliases: ['pepco'] },
  { canonicalSubstr: 'southerncaliforniaedison', aliases: ['sce'] },
  { canonicalSubstr: 'pacificgaselectric', aliases: ['pge', 'pgande'] },
  { canonicalSubstr: 'sandiegogaselectric', aliases: ['sdge'] },
  { canonicalSubstr: 'floridapower', aliases: ['fpl'] },
  { canonicalSubstr: 'publicserviceenterprise', aliases: ['pseg'] },
  { canonicalSubstr: 'commonwealthedison', aliases: ['comed'] },
  { canonicalSubstr: 'duquesnelight', aliases: ['dql'] },
  { canonicalSubstr: 'losangelesdepartmentwaterpower', aliases: ['ladwp'] },
  { canonicalSubstr: 'sacramentomunicipalutility', aliases: ['smud'] },
  { canonicalSubstr: 'tennesseevalleyauthority', aliases: ['tva'] },
  { canonicalSubstr: 'ngrid', aliases: ['nationalgrid'] },
  { canonicalSubstr: 'eversource', aliases: ['nstar'] },
  { canonicalSubstr: 'duke', aliases: ['dukeenergy'] },
];

function normalizedFull(s) {
  // Strip the standalone word "and" before squashing — "Pacific Gas
  // and Electric" should normalize the same as "Pacific Gas & Electric"
  // so the alias-substring check survives either spelling.
  return String(s || '').toLowerCase().replace(/\band\b/g, ' ').replace(/[^a-z0-9]/g, '');
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[()/&,]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2)
    .filter(t => !STOPWORDS.has(t))
    .filter(t => !STATE_CODES.has(t));
}

// Score 0-100 for how well two utility-style names match.
//
//   100 — identical after normalization
//    80 — one is a substring of the other (length ≥ 4)
//    70 — alias hit (e.g. "PEPCO" ↔ "Potomac Electric Power Company")
//   1-60 — Jaccard token overlap, scaled
function similarity(a, b) {
  if (!a || !b) return 0;
  const aFull = normalizedFull(a);
  const bFull = normalizedFull(b);
  if (!aFull || !bFull) return 0;
  if (aFull === bFull) return 100;
  if (aFull.length >= 4 && bFull.includes(aFull)) return 80;
  if (bFull.length >= 4 && aFull.includes(bFull)) return 80;
  // Alias check before tokens — short codes like "BGE" tokenize to a
  // single 3-letter token that won't survive token overlap on its own.
  for (const { canonicalSubstr, aliases } of ALIASES) {
    const aHasAlias = aliases.some(al => aFull.includes(al));
    const bHasCanonical = bFull.includes(canonicalSubstr);
    if (aHasAlias && bHasCanonical) return 70;
    const bHasAlias = aliases.some(al => bFull.includes(al));
    const aHasCanonical = aFull.includes(canonicalSubstr);
    if (bHasAlias && aHasCanonical) return 70;
    if (aHasAlias && bHasAlias) return 70; // both use the same alias
  }
  // Token overlap — Jaccard scaled up to 60.
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const t of aTokens) if (bTokens.has(t)) shared += 1;
  if (shared === 0) return 0;
  // Bonus when a long, distinctive token (≥ 5 chars) is shared —
  // catches "pepco" ↔ "pepco", "dominion" ↔ "dominion", etc.
  let bonus = 0;
  for (const t of aTokens) if (t.length >= 5 && bTokens.has(t)) { bonus = 20; break; }
  const union = new Set([...aTokens, ...bTokens]).size;
  const jaccard = shared / union;
  return Math.min(99, Math.round(jaccard * 60) + bonus);
}

// Find the best matching name from `knownNames` for `candidate`. Returns
// { name, score } when score >= threshold, else null. Threshold defaults
// to 25 on the 0-100 scale — tuned so single-token overlap (e.g.
// "Pepco" ↔ "PEPCO") matches but two unrelated companies don't.
export function findFuzzyMatch(candidate, knownNames, { threshold = 25 } = {}) {
  if (!candidate || !Array.isArray(knownNames) || knownNames.length === 0) return null;
  let best = { score: 0, name: null };
  for (const name of knownNames) {
    const s = similarity(candidate, name);
    if (s > best.score) best = { score: s, name };
    if (s === 100) break; // perfect match — short-circuit
  }
  return best.score >= threshold ? best : null;
}

// Convenience export for tests / debug consoles.
export const _internal = { similarity, normalizedFull, tokenize, ALIASES };
