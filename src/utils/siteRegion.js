// Which of the three headline regions an uploaded site sits in —
// North America / Europe / Rest of World. The Corporate Compliance page
// reports its site counts against these buckets, so the mapping lives
// here rather than inline in the view.
//
// Country is the primary signal, canonicalized through the same country
// reference table (and its alias list — "USA", "U.K.", "Holland", …) the
// rate lookups use, so a site reads the same way here as it does on the
// rest of the Sites page. COUNTRY_RATES already carries a finer-grained
// `region` per country (Sub-Saharan Africa, Southeast Asia, …); those all
// collapse into Rest of World except North America and Europe.
//
// Uploads frequently have no Country column at all — a US or US/Canada
// portfolio where the country is implied. A recognized US state or
// Canadian province still pins those sites to North America. Anything
// left over is reported as Unknown rather than guessed at, so a company's
// region counts always add back up to its site count.

import { countryRates, normalizeCountryRateName } from '../data/countryRates';
import { normalizeState } from './utilityRates';
import { normalizeProvince } from '../data/naMarkets';

export const NORTH_AMERICA = 'North America';
export const EUROPE = 'Europe';
export const REST_OF_WORLD = 'Rest of World';
export const UNKNOWN_REGION = 'Unknown';

// Display order for the three headline buckets. Unknown is deliberately
// last and rendered only when it's non-zero.
export const SITE_REGION_ORDER = [NORTH_AMERICA, EUROPE, REST_OF_WORLD, UNKNOWN_REGION];

/**
 * The region bucket for one site, plus the country label it was resolved
 * to (canonical spelling when the country is on the reference table, the
 * raw upload value when it isn't, '' when nothing resolved).
 * Accepts any object carrying `country` / `state`.
 */
export function siteRegionOf(site) {
  const raw = String(site?.country || '').trim();
  const canonical = normalizeCountryRateName(raw);
  const rated = canonical ? countryRates(canonical) : null;
  if (rated?.region) {
    const region = rated.region === NORTH_AMERICA ? NORTH_AMERICA
      : rated.region === EUROPE ? EUROPE
      : REST_OF_WORLD;
    return { region, country: canonical };
  }
  // No country, or a country the reference table doesn't know. Fall back
  // to the state / province, which pins US and Canadian sites.
  const state = site?.state;
  if (normalizeState(state)) return { region: NORTH_AMERICA, country: raw || 'United States' };
  if (normalizeProvince(state)) return { region: NORTH_AMERICA, country: raw || 'Canada' };
  // A country value we can't place still beats no answer at all — report
  // it under Rest of World with its raw spelling so the user can see what
  // needs cleaning up. A blank country with an unrecognized state is
  // genuinely unknown.
  if (raw) return { region: REST_OF_WORLD, country: raw };
  return { region: UNKNOWN_REGION, country: '' };
}

/**
 * Region breakdown for a list of sites:
 *   { total, counts: { [region]: n }, countries: { [region]: [{ name, count }] } }
 * `counts` always carries all four buckets (zeros included) so callers can
 * render a stable row; `countries` is sorted most-sites-first and powers
 * the hover detail.
 */
export function summarizeSiteRegions(sites) {
  const counts = {};
  const byCountry = {};
  for (const region of SITE_REGION_ORDER) {
    counts[region] = 0;
    byCountry[region] = new Map();
  }
  let total = 0;
  for (const site of (sites || [])) {
    const { region, country } = siteRegionOf(site);
    counts[region] += 1;
    total += 1;
    const label = country || '(no country)';
    byCountry[region].set(label, (byCountry[region].get(label) || 0) + 1);
  }
  const countries = {};
  for (const region of SITE_REGION_ORDER) {
    countries[region] = [...byCountry[region].entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return { total, counts, countries };
}

// ---- California ----
// The Corporate Compliance screening hangs off "how many sites does this
// company have in California" (SB 253 / SB 261), so the test lives here
// rather than being re-spelled at each call site — the page, the Excel
// report and the screening aggregate all have to agree on the number.
//
// A State of "CA" alone isn't enough: an unresolved State column falls
// through as the raw upload text, so "CA" also arrives as a country code
// for Canada and as a Spanish province (Cádiz). The country has to back
// it up. A BLANK country still counts — uploads with no Country column
// at all are the common case for US portfolios, and rejecting those
// would zero out the screening for most companies.

const CALIFORNIA_STATES = new Set(['ca', 'california']);

/** Does this site's State read as California, ignoring the country? */
export function hasCaliforniaState(site) {
  return CALIFORNIA_STATES.has(String(site?.state || '').trim().toLowerCase());
}

/**
 * Is this site in California? Requires a California State AND a country
 * that is either absent or the United States. A country the reference
 * table can't place (a stray region code, a typo) is treated as non-US
 * and excluded — `excludedCaliforniaCountries` reports exactly what was
 * dropped, so a mis-mapped column shows up as a visible number rather
 * than quietly inflating the count.
 */
export function isCaliforniaSite(site) {
  if (!hasCaliforniaState(site)) return false;
  const raw = String(site?.country || '').trim();
  if (!raw) return true;
  return normalizeCountryRateName(raw) === 'United States';
}

/**
 * Rows with a California State that the country test rejected, as
 * [{ name, count }] most-first — the countries behind them, using the raw
 * upload spelling when the reference table can't place it. Empty when
 * every "CA" row checks out.
 */
export function excludedCaliforniaCountries(sites) {
  const counts = new Map();
  for (const site of (sites || [])) {
    if (!hasCaliforniaState(site) || isCaliforniaSite(site)) continue;
    const raw = String(site?.country || '').trim();
    const label = normalizeCountryRateName(raw) || raw || '(no country)';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** "United States 180 · Canada 5" — the hover detail for one bucket. */
export function regionCountryLabel(countries) {
  if (!countries || countries.length === 0) return 'No sites';
  return countries.map(c => `${c.name} ${c.count}`).join(' · ');
}
