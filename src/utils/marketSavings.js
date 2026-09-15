// The seller's own savings figures, laid over the shipped defaults.
//
// Lists > Market Savings lets the seller retype the low / high indicative
// savings percentage for any US state, Canadian province or country, for
// electric and for gas. What they type is stored per user under
// settings.marketSavings and read back here, so every surface that quotes
// a band — the Indicative Savings sheets, the by-state overview, the site
// detail rows — quotes the edited one.
//
// What an override can and cannot do:
//
//   * It sets the LOW and HIGH percentage of a market that already earns
//     a band. That is the whole point: the shipped 2 - 4 % is a house
//     default, and a seller with bid history knows better for their own
//     markets. Europe ships as "TBD" with no committed figures at all, so
//     this is also how a European country gets one.
//   * It does NOT decide whether a market is competitive. Deregulation
//     status stays with the reference tables (marketSavingsBands.js for
//     US/CA, countryDeregulation.js for the rest), because that status
//     also drives which sites are counted as deregulated, which tier a
//     market lands in, and what the exports say about the market itself.
//     Typing a number cannot make a regulated market competitive, and a
//     regulated market still earns nothing, so the editor shows those
//     rows without editable figures rather than accepting a number that
//     would quietly do nothing.
//
// Percentages are stored the way they are typed — 2.5 means 2.5 % — and
// converted to the fractional lowPct / highPct the savings maths uses on
// the way out. The stored shape:
//
//   settings.marketSavings = {
//     states:    { TX: { electric: { low: 1, high: 2.5 } } },
//     countries: { germany: { name: 'Germany', gas: { low: 3, high: 5 } } },
//   }
//
// Country keys are slugged because these become dotted Firestore paths
// and a country name is free to carry spaces and punctuation; the
// canonical name rides along in `name` so a key can always be read back.

import { STATE_ELECTRIC_BANDS, STATE_GAS_BANDS, VA_ELECTRIC_BAND } from '../data/marketSavingsBands.js';
import { US_MARKETS, CA_MARKETS } from '../data/naMarkets.js';
import {
  COUNTRY_DEREGULATION,
  normalizeCountryName,
  countryElectricSavings,
  countryGasSavings,
} from '../data/countryDeregulation.js';

export const MARKET_SAVINGS_SETTINGS_KEY = 'marketSavings';

/** The two commodities a market carries a band for. */
export const SAVINGS_COMMODITIES = ['electric', 'gas'];

/**
 * Every US state / Canadian province the editor lists, in the order it
 * lists them. Drawn from naMarkets so a market added there shows up here
 * without a second edit.
 */
export const NA_MARKET_ROWS = [
  ...US_MARKETS.map(m => ({ code: m.code, name: m.name, nation: 'United States' })),
  ...CA_MARKETS.map(m => ({ code: m.code, name: m.name, nation: 'Canada' })),
];

/**
 * Every country on the deregulation reference, alphabetically, with the
 * region it is grouped under.
 */
export const COUNTRY_MARKET_ROWS = Object.keys(COUNTRY_DEREGULATION)
  .sort((a, b) => a.localeCompare(b))
  .map(name => ({ name, region: COUNTRY_DEREGULATION[name].region || '' }));

/** Firestore-safe key for a country name. */
export function countrySavingsKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * "2 - 4%" for a band, "2%" when the two ends meet, '' when there is no
 * band. Matches the spelling the shipped tables use, hyphen and all, so
 * an edited row reads like an unedited one wherever the range is shown.
 */
export function formatSavingsRange(lowPct, highPct) {
  if (lowPct == null || highPct == null) return '';
  const low = trimPct(lowPct * 100);
  const high = trimPct(highPct * 100);
  return low === high ? `${low}%` : `${low} - ${high}%`;
}

// 2, 2.5, 0.25 — never 2.50 and never 2.4999999999999996.
function trimPct(n) {
  return String(Math.round(n * 1000) / 1000);
}

function readOverrides(settings) {
  const raw = settings?.[MARKET_SAVINGS_SETTINGS_KEY];
  return (raw && typeof raw === 'object') ? raw : {};
}

// A stored { low, high } is only usable when both ends are finite
// non-negative numbers: a half-typed row must not quote half a band.
function normalizePair(pair) {
  if (!pair || typeof pair !== 'object') return null;
  const low = Number(pair.low);
  const high = Number(pair.high);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (low < 0 || high < 0) return null;
  return { low, high };
}

/** The raw stored pair for a state, or null. Percentages as typed. */
export function stateSavingsOverride(settings, code, commodity) {
  const entry = readOverrides(settings).states?.[String(code || '').toUpperCase()];
  return normalizePair(entry?.[commodity]);
}

/** The raw stored pair for a country, or null. Percentages as typed. */
export function countrySavingsOverride(settings, name, commodity) {
  const entry = readOverrides(settings).countries?.[countrySavingsKey(name)];
  return normalizePair(entry?.[commodity]);
}

/**
 * True when a band can be retyped at all: a market has to be earning one
 * for a figure to mean anything. Regulated / no-opportunity markets are
 * shown in the editor but not edited — see the note at the top.
 *
 * A band of 0 - 0 % counts as earning one. Limited and large-load-only
 * markets sit there on purpose, and a seller who wins a deal in one is
 * exactly who would want to raise it off the floor.
 */
export function bandIsEditable(band) {
  return !!band && (band.lowPct != null || band.highPct != null || band.range === 'TBD');
}

/**
 * Lay an override over a shipped band. Keeps the band's status and
 * returns a fresh { status, range, lowPct, highPct } so callers can't
 * mutate the reference tables.
 */
export function applySavingsOverride(band, pair) {
  if (!band) return band;
  if (!pair || !bandIsEditable(band)) return { ...band };
  const lowPct = pair.low / 100;
  const highPct = pair.high / 100;
  return { ...band, lowPct, highPct, range: formatSavingsRange(lowPct, highPct) };
}

/**
 * The electric and gas band maps SitesView works from: the shipped
 * tables with the seller's edits laid over them.
 *
 * `includeVirginiaElectric` folds in the large-load-gated Virginia entry,
 * and is the caller's call because only the caller knows whether the
 * uploaded portfolio has a site big enough to clear the threshold.
 */
export function stateSavingsBands(settings, { includeVirginiaElectric = false } = {}) {
  const electric = { ...STATE_ELECTRIC_BANDS };
  if (includeVirginiaElectric) electric.VA = VA_ELECTRIC_BAND;
  const gas = { ...STATE_GAS_BANDS };
  for (const [code, band] of Object.entries(electric)) {
    electric[code] = applySavingsOverride(band, stateSavingsOverride(settings, code, 'electric'));
  }
  for (const [code, band] of Object.entries(gas)) {
    gas[code] = applySavingsOverride(band, stateSavingsOverride(settings, code, 'gas'));
  }
  return { electric, gas };
}

/**
 * The shipped band for a state, before any override — what the editor
 * shows a row as resetting to. Virginia's electric band is included
 * here whatever the upload holds, since the editor edits the standing
 * figure rather than one portfolio's view of it.
 */
export function defaultStateBand(code, commodity) {
  const key = String(code || '').toUpperCase();
  if (commodity === 'electric') return STATE_ELECTRIC_BANDS[key] || (key === 'VA' ? VA_ELECTRIC_BAND : null);
  return STATE_GAS_BANDS[key] || null;
}

/** The shipped band for a country, before any override. */
export function defaultCountryBand(name, commodity) {
  return commodity === 'electric' ? countryElectricSavings(name) : countryGasSavings(name);
}

/**
 * A country's band with the seller's edits laid over it. Same shape and
 * same null-when-unknown contract as countryElectricSavings /
 * countryGasSavings, which is what every caller already expects.
 */
export function countrySavings(settings, rawCountry, commodity) {
  const band = defaultCountryBand(rawCountry, commodity);
  if (!band) return null;
  const canonical = normalizeCountryName(rawCountry);
  return applySavingsOverride(band, countrySavingsOverride(settings, canonical, commodity));
}

/** How many markets carry an edit, for the editor's header. */
export function countSavingsOverrides(settings) {
  const overrides = readOverrides(settings);
  let count = 0;
  for (const scope of [overrides.states, overrides.countries]) {
    for (const entry of Object.values(scope || {})) {
      for (const commodity of SAVINGS_COMMODITIES) {
        if (normalizePair(entry?.[commodity])) count++;
      }
    }
  }
  return count;
}
