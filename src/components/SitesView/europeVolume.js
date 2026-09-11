// "This European country is big enough to source" — the volume threshold
// flagged on the Indicative Savings tab.
//
// A European country row on that tab reads almost the same whether it
// carries 200 MWh or 200 GWh: the commodity band is TBD across Europe, so
// the savings columns are $0 either way and the only number separating a
// rounding-error market from one worth a dedicated sourcing motion is a
// raw consumption figure buried mid-row. Sellers were scanning for it by
// eye, per country, twice (once per commodity).
//
// So every European country carrying more than 10 GWh/yr of a commodity
// gets named in the sheet's Findings & Recommendations band, with its
// volume, sorted biggest first.
//
// Two decisions worth stating, because both are invisible from the output:
//
// 1. The basis is TOTAL consumption in the country, not the Deregulated
//    Consumption column. The question the threshold answers is "is there
//    enough load here to be worth a motion", which is true whether or not
//    the classifier has placed the sites yet — and European uploads
//    routinely arrive with no utility and no supplier per site, which
//    lands the whole country in Unclassified Sites with a deregulated
//    consumption of zero. Gating on the dereg column would silently drop
//    exactly the portfolios this is for.
//
// 2. Gas is compared in kWh-equivalent, not in Dth. 10 GWh/yr is a
//    European unit of measure and the ask was one threshold "per
//    commodity", so the gas side converts its Dth back to the energy
//    content it was parsed from rather than comparing a therm count to a
//    kilowatt-hour count.
//
// Lives outside SitesView.jsx so both can be asserted directly — see
// scripts/europeVolume.test.mjs.
import { isEuropeanCountry } from '../../data/countryDeregulation.js';
import { KWH_PER_THERM } from '../../data/countryRates.js';

// Above this much of one commodity in one European country, the market is
// large enough to call out. GWh per year.
export const EUROPE_VOLUME_GWH = 10;

const KWH_PER_GWH = 1_000_000;
// The savings tab reports gas in decatherms; the uploads are parsed in
// therms (1 Dth = 10 therms) off the same energy content the rate
// conversions use.
const KWH_PER_DTH = KWH_PER_THERM * 10;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * The row's annual consumption in GWh, whichever commodity it is.
 *
 * `totalConsumption` is every site in the bucket, regulated ones
 * included — electric in kWh, gas in Dth, exactly as the savings tab's
 * consumption columns are denominated.
 */
export function annualGWh(row, commodity = 'electric') {
  const perUnit = commodity === 'gas' ? KWH_PER_DTH : 1;
  return (num(row?.totalConsumption) * perUnit) / KWH_PER_GWH;
}

/**
 * Is this a European country market carrying more than the threshold?
 *
 * The test is the row's own label: international buckets are labelled
 * with the country, US / Canadian ones with a two-letter state code, and
 * no state or province code resolves to a country on the reference
 * table's alias list (asserted in the tests) — so asking the table
 * whether the label is a European country separates them cleanly.
 *
 * Deliberately NOT keyed off `row.isCountry`: the flag is set on the
 * bucket but never copied onto the exported row, so it reads undefined
 * on every row this ever sees.
 *
 * Synthetic parent rows are excluded outright. They aggregate children
 * ("United States", "Canada"), so a threshold on one would be answering
 * a different question than the per-country one asked here.
 */
export function isLargeEuropeanMarket(row, commodity = 'electric') {
  if (!row || row.isParent) return false;
  if (!isEuropeanCountry(row.state)) return false;
  return annualGWh(row, commodity) > EUROPE_VOLUME_GWH;
}

/**
 * Every European country over the threshold, biggest first, as
 * `[{ country, gwh }]`. Empty when none qualify — the caller drops the
 * finding rather than printing an empty bullet.
 */
export function largeEuropeanMarkets(rows, commodity = 'electric') {
  return (rows || [])
    .filter((row) => isLargeEuropeanMarket(row, commodity))
    .map((row) => ({ country: row.state, gwh: annualGWh(row, commodity) }))
    .sort((a, b) => b.gwh - a.gwh || String(a.country).localeCompare(String(b.country)));
}

/** "Germany 42.1 GWh" — one market as it reads in the findings bullet. */
export function largeEuropeanMarketLabel({ country, gwh }) {
  // One decimal: these run from just over 10 to a few hundred, and the
  // tenth is what separates two mid-size markets from each other.
  return `${country} ${gwh.toFixed(1)} GWh`;
}
