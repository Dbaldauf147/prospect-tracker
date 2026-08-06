// Matching an opportunity's Scope text to the service catalogue.
//
// Scope is typed shorthand — "GHG; Budgets", "RA + pull through" — and
// three places have to turn it into catalogue services: the company
// card's Services Explored grid, Opps 2's Scope picker, and the Pipeline
// coverage table (which the Issues tab's coverage warning reads from).
// All three had their own copy of the rule, and a service that matches in
// one place and not another is a board disagreeing with itself.
//
// The rule used to be substring containment in either direction:
//
//     item.includes(token) || token.includes(item)
//
// which is far looser than it looks. A Scope of "RA" matched 14 of the
// 143 catalogue services — including "St[ra]tegic sourcing" and
// "[Ra]te optimization", which have nothing to do with RA. Every one of
// those got an automatic status from an opp that never mentioned it.
//
// So matching is now on whole WORDS. "GHG" still finds "Comp GHG",
// because ["ghg"] is a run of ["comp","ghg"] — the shorthand case the
// looseness existed for. "ra" is not a word of "strategic sourcing", so
// that one stops.
//
// Import-free, so the rule can be pinned under plain Node
// (scripts/scopeMatch.test.mjs).

/** Split a Scope cell into its service tokens. */
export function scopeTokens(scope) {
  return String(scope || '').split(/[;,/]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * A name reduced to comparable words.
 *
 * Punctuation, case and separators fall away, and a trailing "s" is
 * dropped from words long enough that it is a plural rather than part of
 * the word — so a Scope of "UPR" matches the catalogue's "UPRs" while
 * "EPS" stays "eps" rather than becoming "ep". The stemming only has to
 * be CONSISTENT, since both sides go through this same function; it does
 * not have to be linguistically right.
 */
export function serviceWords(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(w => (w.length >= 4 && w.endsWith('s') ? w.slice(0, -1) : w));
}

/** Do `needle`'s words appear as a contiguous run inside `hay`'s? */
function hasWordRun(hay, needle) {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i <= hay.length - needle.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Does this scope token name this catalogue service?
 *
 * Both directions, as before: a token shorter than the service is
 * shorthand for it ("GHG" → "Comp GHG"), and a token longer than the
 * service is a scope written out more fully than the catalogue entry
 * ("Invoice collection - light" → "Invoice collection"). What changed is
 * that each is now a run of whole words rather than any substring.
 */
export function scopeTokenMatchesService(token, service) {
  const t = serviceWords(token);
  const s = serviceWords(service);
  if (t.length === 0 || s.length === 0) return false;
  return hasWordRun(s, t) || hasWordRun(t, s);
}

/**
 * Every catalogue service a Scope cell names.
 *
 * `services` is the flat list of catalogue item names.
 */
export function servicesInScope(scope, services) {
  const tokens = scopeTokens(scope);
  if (tokens.length === 0) return [];
  const out = [];
  for (const service of (services || [])) {
    if (tokens.some(token => scopeTokenMatchesService(token, service))) out.push(service);
  }
  return out;
}
