// Classify a headquarters location string as North America or not.
//
// The company popup stores HQ Region as one of exactly two values
// ("North America" / "Outside of North America"), while every source of HQ
// data we have — the curated /api/hq-lookup map, the My Accounts HQ Location
// column, the revenue-research blob — carries a free-text location like
// "Toronto, Ontario, Canada" or "Zug, Switzerland". This turns one into the
// other so the Corporate Compliance card can fill that popup field when it's
// blank.

import { countryNameFromIso3 } from '../data/countryIso3.js';

export const NORTH_AMERICA = 'North America';
export const OUTSIDE_NORTH_AMERICA = 'Outside of North America';

// Country names / abbreviations that put a location in North America. The
// list is deliberately the three mainland countries plus the US and Canadian
// territories that show up as their own "country" in address data — Puerto
// Rico is written as its own line in several sources even though it is a US
// territory.
const NA_COUNTRIES = new Set([
  // `clean` strips a trailing period, so the abbreviations are listed in
  // both forms — 'u.s.' arrives here as 'u.s'.
  'united states', 'united states of america', 'usa', 'u.s.a.', 'u.s.a',
  'us', 'u.s.', 'u.s',
  'america', 'canada', 'mexico', 'méxico', 'puerto rico', 'bermuda',
  'greenland', 'guam', 'us virgin islands', 'u.s. virgin islands',
]);

// A bare US state / Canadian province is enough on its own — "Dallas, Texas"
// with no country still lands in North America. Only the unambiguous ones:
// no two-letter codes, which collide with other countries' subdivisions.
const NA_SUBDIVISIONS = new Set([
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'district of columbia', 'florida', 'georgia',
  'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky',
  'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
  'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota',
  'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island',
  'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont',
  'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
  'alberta', 'british columbia', 'manitoba', 'new brunswick',
  'newfoundland and labrador', 'nova scotia', 'ontario', 'quebec', 'québec',
  'saskatchewan',
]);

const clean = (s) => String(s || '').trim().toLowerCase().replace(/\.$/, '');

/**
 * "Toronto, Ontario, Canada" → "North America".
 * "Zug, Switzerland"         → "Outside of North America".
 * ""                         → "" (unknown — never guess from nothing).
 *
 * A location we can't place at all also returns '' rather than defaulting to
 * "Outside of North America": a wrong region written into the popup field is
 * worse than a blank one the user can still fill by hand.
 */
export function classifyHqRegion(location) {
  const parts = String(location || '')
    .split(',')
    .map(clean)
    .filter(Boolean);
  if (parts.length === 0) return '';

  // Country is conventionally last; check it first, then fall back to any
  // segment (some sources write "United States, Texas, Dallas").
  const country = parts[parts.length - 1];
  if (NA_COUNTRIES.has(country)) return NORTH_AMERICA;
  if (parts.some(p => NA_COUNTRIES.has(p))) return NORTH_AMERICA;

  // No recognised country — a US state or Canadian province still places it.
  if (parts.some(p => NA_SUBDIVISIONS.has(p))) return NORTH_AMERICA;

  // A recognisable country that isn't in North America. Requiring a country
  // segment (rather than treating every unmatched string as foreign) keeps a
  // bare city name — "Houston" — from being called Outside of North America.
  return parts.length > 1 ? OUTSIDE_NORTH_AMERICA : '';
}

/**
 * The same call for a bare HQ Country cell rather than a full location.
 *
 * classifyHqRegion needs a second comma-part before it will call anything
 * foreign, so "Singapore" on its own comes back unknown — deliberately, since
 * a lone segment there might be a city. A Country column carries no such
 * ambiguity: the cell IS the country, so anything that isn't one of ours is
 * outside North America. Only an empty cell is unknown.
 *
 * ISO 3166-1 alpha-3 codes resolve first ("CAN" → Canada), matching the site
 * lists that write the Country column that way.
 */
export function classifyHqCountry(country) {
  const raw = String(country || '').trim();
  if (!raw) return '';
  const v = clean(countryNameFromIso3(raw) || raw);
  if (!v) return '';
  // A US state or Canadian province written into a Country cell still places
  // the company — the cell is wrong about what it holds, not about where.
  if (NA_COUNTRIES.has(v) || NA_SUBDIVISIONS.has(v)) return NORTH_AMERICA;
  return OUTSIDE_NORTH_AMERICA;
}

// Accept only the two values the company popup's dropdown offers, so a
// researched string that drifted ("N. America", "EMEA") can't be persisted
// into a field that renders as a select.
export function normalizeHqRegion(value) {
  const v = clean(value);
  if (!v) return '';
  if (v === clean(NORTH_AMERICA)) return NORTH_AMERICA;
  if (v === clean(OUTSIDE_NORTH_AMERICA)) return OUTSIDE_NORTH_AMERICA;
  return '';
}
