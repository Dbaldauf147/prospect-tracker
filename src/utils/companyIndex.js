// Company-name matching index. Mirrors the rules of `companiesMatch`
// (lower-case + trim equality, NFKD-normalized equality, suffix-stripped
// equality, single-token "acronym" rule) but precomputes lookup maps so a
// pairwise query against N indexed strings is O(1) instead of O(N) calls
// to companiesMatch. The substring-with-length-threshold rule is dropped
// because it's hard to index efficiently and the suffix-stripped path
// already covers the common cases. Use this when matching one query
// against a large set (per-prospect contact/opps/dm lookups).

const DIACRITICS_RE = /[̀-ͯ]/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const NON_ALNUM_SPACE_RE = /[^a-z0-9 ]/g;
const WS_RE = /\s+/g;
const CORP_SUFFIX_RE = /\b(inc|llc|ltd|corp|co|lp)\b\.?/gi;

function flatten(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(NON_ALNUM_RE, ' ')
    .trim()
    .replace(WS_RE, ' ');
}

function strip(s) {
  return String(s || '')
    .toLowerCase()
    .replace(CORP_SUFFIX_RE, '')
    .replace(NON_ALNUM_SPACE_RE, '')
    .trim();
}

function tokensOf(s) {
  return String(s || '')
    .toLowerCase()
    .replace(NON_ALNUM_SPACE_RE, ' ')
    .split(WS_RE)
    .filter(Boolean);
}

function squish(s) {
  return String(s || '').toLowerCase().trim().replace(WS_RE, ' ');
}

function addTo(map, key, value) {
  let set = map.get(key);
  if (!set) { set = new Set(); map.set(key, set); }
  set.add(value);
}

export function buildCompanyIndex(strings) {
  const flatTo = new Map();
  const strippedTo = new Map();
  const squishTo = new Map();
  const tokenAppearsIn = new Map(); // token → strings whose tokens contain it
  const singleTokenIs = new Map();  // token → strings that ARE single-token == token
  for (const s of strings || []) {
    if (!s) continue;
    const lower = String(s).toLowerCase().trim();
    if (!lower) continue;
    const sq = squish(lower);
    if (sq) addTo(squishTo, sq, s);
    const f = flatten(lower);
    if (f) addTo(flatTo, f, s);
    const st = strip(lower);
    if (st) addTo(strippedTo, st, s);
    const tokens = tokensOf(lower);
    if (tokens.length === 1 && tokens[0].length >= 3) {
      addTo(singleTokenIs, tokens[0], s);
    }
    for (const t of tokens) {
      if (t.length >= 3) addTo(tokenAppearsIn, t, s);
    }
  }
  return { flatTo, strippedTo, squishTo, tokenAppearsIn, singleTokenIs };
}

export function findMatchesInIndex(index, query) {
  const matches = new Set();
  if (!index || !query) return matches;
  const lower = String(query).toLowerCase().trim();
  if (!lower) return matches;
  const sq = squish(lower);
  if (sq) {
    const hit = index.squishTo.get(sq);
    if (hit) for (const s of hit) matches.add(s);
  }
  const f = flatten(lower);
  if (f) {
    const hit = index.flatTo.get(f);
    if (hit) for (const s of hit) matches.add(s);
  }
  const st = strip(lower);
  if (st) {
    const hit = index.strippedTo.get(st);
    if (hit) for (const s of hit) matches.add(s);
  }
  const tokens = tokensOf(lower);
  if (tokens.length === 1 && tokens[0].length >= 3) {
    const hit = index.tokenAppearsIn.get(tokens[0]);
    if (hit) for (const s of hit) matches.add(s);
  } else if (tokens.length > 1) {
    for (const t of tokens) {
      if (t.length < 3) continue;
      const hit = index.singleTokenIs.get(t);
      if (hit) for (const s of hit) matches.add(s);
    }
  }
  return matches;
}

// Convenience: does the query match any entry in the index?
export function hasMatchInIndex(index, query) {
  if (!index || !query) return false;
  const lower = String(query).toLowerCase().trim();
  if (!lower) return false;
  const sq = squish(lower);
  if (sq && index.squishTo.has(sq)) return true;
  const f = flatten(lower);
  if (f && index.flatTo.has(f)) return true;
  const st = strip(lower);
  if (st && index.strippedTo.has(st)) return true;
  const tokens = tokensOf(lower);
  if (tokens.length === 1 && tokens[0].length >= 3) {
    if (index.tokenAppearsIn.has(tokens[0])) return true;
  } else if (tokens.length > 1) {
    for (const t of tokens) {
      if (t.length >= 3 && index.singleTokenIs.has(t)) return true;
    }
  }
  return false;
}
