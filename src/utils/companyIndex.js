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

// Ownership phrases like ", a Simon Property Group Co." or
// "(a Brookfield Co.)" — patterns where a subsidiary is described by
// embedding its parent's full name. The substring rule below would
// otherwise see the parent inside the subsidiary's display name and
// merge them (e.g. "Kering, a Simon Property Group Co." matched
// "Simon Property Group"). Strip the phrase off the query before the
// substring check so subsidiaries don't inherit parent matches.
const OWNERSHIP_PHRASE_RE = /[,(]\s*an?\s+[^()]+?\s+co(\.|mpany)?\)?\.?\s*$/i;
function removeOwnershipPhrase(s) {
  return String(s || '').replace(OWNERSHIP_PHRASE_RE, '').trim();
}

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

function substringMatch(a, b) {
  // Mirrors the substring + length-threshold rule from companiesMatch:
  // shorter must be ≥ 4 chars and ≥ 60% of longer.length, and longer
  // must contain shorter as a substring.
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  return shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter);
}

export function buildCompanyIndex(strings) {
  const flatTo = new Map();
  const strippedTo = new Map();
  const squishTo = new Map();
  const tokenAppearsIn = new Map(); // token → strings whose tokens contain it
  const singleTokenIs = new Map();  // token → strings that ARE single-token == token
  const meta = new Map();           // original → { lower, stripped }
  for (const s of strings || []) {
    if (!s) continue;
    const lower = String(s).toLowerCase().trim();
    if (!lower) continue;
    const stripped = strip(lower);
    meta.set(s, { lower, stripped });
    const sq = squish(lower);
    if (sq) addTo(squishTo, sq, s);
    const f = flatten(lower);
    if (f) addTo(flatTo, f, s);
    if (stripped) addTo(strippedTo, stripped, s);
    const tokens = tokensOf(lower);
    if (tokens.length === 1 && tokens[0].length >= 3) {
      addTo(singleTokenIs, tokens[0], s);
    }
    for (const t of tokens) {
      if (t.length >= 3) addTo(tokenAppearsIn, t, s);
    }
  }
  return { flatTo, strippedTo, squishTo, tokenAppearsIn, singleTokenIs, meta };
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
  // Substring + length-threshold rule. Narrowed to candidates that
  // share at least one significant token with the query so we run the
  // (cheap) substring check against ~tens of strings instead of all N.
  // Catches cases like "Bank of America" ↔ "Bank of America Holdings"
  // where the extra word isn't a corporate suffix the strip rule knows
  // about.
  if (lower.length >= 4) {
    const queryNoOwner = removeOwnershipPhrase(lower);
    const queryStripped = strip(queryNoOwner);
    const candidates = new Set();
    for (const t of tokens) {
      if (t.length < 3) continue;
      const hit = index.tokenAppearsIn.get(t);
      if (hit) for (const s of hit) candidates.add(s);
    }
    for (const s of candidates) {
      if (matches.has(s)) continue;
      const m = index.meta && index.meta.get(s);
      if (!m) continue;
      if (substringMatch(queryNoOwner, m.lower)) { matches.add(s); continue; }
      if (queryStripped && m.stripped && substringMatch(queryStripped, m.stripped)) {
        matches.add(s);
      }
    }
  }
  return matches;
}

// Strict variant of findMatchesInIndex: matches only on exact (lower /
// flatten / suffix-stripped) equality or the substring + length-threshold
// rule. It deliberately omits the loose single-token "acronym" rule, so a
// one-word name (e.g. an opp filed under "Blackstone") will NOT match a
// multi-word lookalike account ("Blackstone GP Stakes"). Use this where a
// brand-prefix coincidence would wrongly link two different accounts.
export function findStrictMatchesInIndex(index, query) {
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
  // Substring + length-threshold rule (the same tight rule the loose
  // matcher uses) — but without any of the single-token shortcuts above it.
  if (lower.length >= 4) {
    const queryNoOwner = removeOwnershipPhrase(lower);
    const queryStripped = strip(queryNoOwner);
    const candidates = new Set();
    for (const t of tokensOf(lower)) {
      if (t.length < 3) continue;
      const hit = index.tokenAppearsIn.get(t);
      if (hit) for (const s of hit) candidates.add(s);
    }
    for (const s of candidates) {
      if (matches.has(s)) continue;
      const m = index.meta && index.meta.get(s);
      if (!m) continue;
      if (substringMatch(queryNoOwner, m.lower)) { matches.add(s); continue; }
      if (queryStripped && m.stripped && substringMatch(queryStripped, m.stripped)) {
        matches.add(s);
      }
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
  if (lower.length >= 4 && index.meta) {
    const queryStripped = strip(lower);
    const candidates = new Set();
    for (const t of tokens) {
      if (t.length < 3) continue;
      const hit = index.tokenAppearsIn.get(t);
      if (hit) for (const s of hit) candidates.add(s);
    }
    for (const s of candidates) {
      const m = index.meta.get(s);
      if (!m) continue;
      if (substringMatch(lower, m.lower)) return true;
      if (queryStripped && m.stripped && substringMatch(queryStripped, m.stripped)) return true;
    }
  }
  return false;
}
