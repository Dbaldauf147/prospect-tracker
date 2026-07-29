// Reverse zip lookup: estimate a missing zip code from a known city +
// state by reusing the zip → { city, state } pairs already present in
// the Utility Lookup's zipMap (the "database" the user has uploaded).
//
// The forward lookup keys utilities by zip. Here we invert that map so
// a site that arrives with a city + state but no zip can borrow a
// representative zip from the other sites/utilities we already know
// live in that same city. The estimate then flows through the normal
// zip → utility / state / rate pipeline just like a real zip would,
// flagged so the UI can show it's modeled rather than uploaded.

import { normalizeState } from './utilityRates';

// Canonical key for a city name so cosmetic variants collapse together:
// case, surrounding whitespace, internal double-spaces, and trailing
// punctuation ("St. Louis" / "st louis", "New York " / "new york").
export function normalizeCityKey(city) {
  if (city == null) return '';
  return String(city)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // drop periods, commas, etc.
    .replace(/\s+/g, ' ')
    .trim();
}

// Build a { "STATE|citykey": [zip, …] } reverse index from a forward
// zipMap. Only entries that carry BOTH a city and a US state can be
// reverse-matched, so anything missing either is skipped. Candidate
// zips are de-duped and sorted ascending for a deterministic estimate.
// Returns null when there's nothing usable to index.
export function buildCityStateZipIndex(zipMap) {
  if (!zipMap) return null;
  const index = new Map();
  for (const [zip, entry] of Object.entries(zipMap)) {
    if (!zip || !entry) continue;
    const state = normalizeState(entry.state);
    const cityKey = normalizeCityKey(entry.city);
    if (!state || !cityKey) continue;
    const key = `${state}|${cityKey}`;
    let bucket = index.get(key);
    if (!bucket) {
      bucket = new Set();
      index.set(key, bucket);
    }
    bucket.add(zip);
  }
  if (!index.size) return null;
  // Freeze each bucket to a sorted array.
  const out = new Map();
  for (const [key, set] of index) {
    out.set(key, Array.from(set).sort());
  }
  return out;
}

// Pick the single most representative zip from a set of candidates for
// one city. A city can span many zips; we group them by 3-digit prefix
// (the postal sectional area), take the dominant prefix, and return its
// lowest zip. This avoids an outlier P.O.-box or fringe zip when the
// bulk of the city clearly sits in one area.
function pickRepresentativeZip(zips) {
  if (zips.length === 1) return zips[0];
  const byPrefix = new Map();
  for (const z of zips) {
    const p = z.slice(0, 3);
    const list = byPrefix.get(p);
    if (list) list.push(z);
    else byPrefix.set(p, [z]);
  }
  let bestPrefix = null;
  let bestCount = -1;
  for (const [p, list] of byPrefix) {
    // Larger group wins; ties break toward the lower prefix for
    // determinism.
    if (list.length > bestCount || (list.length === bestCount && p < bestPrefix)) {
      bestPrefix = p;
      bestCount = list.length;
    }
  }
  return byPrefix.get(bestPrefix)[0];
}

// Build a { "STATE|citykey": zip } map from a user-uploaded fallback
// list of { city, state, zip } records. Unlike the reverse index above
// (which infers candidate zips from other sites in the same city), this
// is an explicit, authoritative city → zip mapping the user provides, so
// each city/state resolves to exactly one zip. Later rows win on a
// collision. Returns null when there's nothing usable.
export function buildCityStateZipFallback(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const out = new Map();
  for (const row of list) {
    if (!row) continue;
    const state = normalizeState(row.state);
    const cityKey = normalizeCityKey(row.city);
    const zip = normalizeFallbackZip(row.zip);
    if (!state || !cityKey || !zip) continue;
    out.set(`${state}|${cityKey}`, zip);
  }
  return out.size ? out : null;
}

// Light zip normalization for the fallback list — strip to the first
// 5 digits, left-padding short values (Excel drops the leading zero on
// New England zips). Mirrors normalizeZip in utilityRatesStore without
// importing it to keep this module dependency-light.
function normalizeFallbackZip(value) {
  if (value == null) return '';
  const digits = String(value).trim().split('-')[0].replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 5 ? digits.slice(0, 5) : digits.padStart(5, '0');
}

// Estimate a zip for a (city, state) pair. The user-uploaded `fallback`
// map (city → zip) is consulted first since it's an explicit mapping;
// otherwise we fall back to the `index` inferred from the utility lookup.
// Either source may be null. Returns { zip, candidateCount, source }
// when the city+state is known, else null. `state` may be a 2-letter
// code or a full name — it's normalized to match the keys.
export function estimateZipFromCityState(index, city, state, fallback = null) {
  const stateCode = normalizeState(state);
  const cityKey = normalizeCityKey(city);
  if (!stateCode || !cityKey) return null;
  const key = `${stateCode}|${cityKey}`;
  if (fallback) {
    const fz = fallback.get(key);
    if (fz) return { zip: fz, candidateCount: 1, source: 'fallback' };
  }
  if (!index) return null;
  const candidates = index.get(key);
  if (!candidates || !candidates.length) return null;
  return {
    zip: pickRepresentativeZip(candidates),
    candidateCount: candidates.length,
    source: 'lookup',
  };
}
