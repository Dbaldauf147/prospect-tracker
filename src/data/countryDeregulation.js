// Per-country deregulation reference used by the Indicative Savings
// export to score international (non-US/Canada) sites. Three buckets
// per country — Electric Power, Gas, Power Rate Optimization — each
// one of: 'Deregulated', 'Some deregulation', 'Unlikely', or
// 'No opportunity'.
//
// "Deregulated" / "Some deregulation" on Electric Power or Gas →
// commodity-savings motion applies (2 - 4 % on annual spend).
// "Power Rate Optimization" of "Deregulated" / "Some deregulation" →
// regulated-rate motion applies (flat 0.25 % on regulated electric
// spend) — same mechanic the US (state, utility) reg-rate-opportunity
// list drives. The two motions are mutually exclusive per site: a
// country whose Electric Power is already deregulated doesn't also
// earn reg-rate savings on top.

import { countryNameFromIso3 } from './countryIso3.js';

export const COUNTRY_DEREGULATION = {
  'Afghanistan': { region: 'Central Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Albania': { region: 'Europe', electric: 'No opportunity', gas: 'Deregulated', powerRateOptimization: 'No opportunity' },
  'Algeria': { region: 'North Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Angola': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Argentina': { region: 'South America', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'No opportunity' },
  'Armenia': { region: 'Europe/Asia', electric: 'No opportunity', gas: 'Some deregulation', powerRateOptimization: 'No opportunity' },
  'Australia': { region: 'Oceania', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Austria': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Some deregulation' },
  'Azerbaijan': { region: 'Europe/Asia', electric: 'No opportunity', gas: 'Unlikely', powerRateOptimization: 'Some deregulation' },
  'Bangladesh': { region: 'South Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Belarus': { region: 'Europe', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Belgium': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Some deregulation' },
  'Belize': { region: 'Central America', electric: 'Some deregulation', gas: 'Some deregulation', powerRateOptimization: 'Some deregulation' },
  'Benin': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Bhutan': { region: 'South Asia', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Bolivia': { region: 'South America', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Bosnia and Herzegovina': { region: 'Europe', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Botswana': { region: 'Africa', electric: 'Some deregulation', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Brazil': { region: 'South America', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Brunei': { region: 'Southeast Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Bulgaria': { region: 'Europe', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Burkina Faso': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Burundi': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Cambodia': { region: 'Southeast Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Cameroon': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Canada': { region: 'North America', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Unlikely' },
  'Central African Republic': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Chad': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Chile': { region: 'South America', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Some deregulation' },
  'China': { region: 'East Asia', electric: 'Some deregulation', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Colombia': { region: 'South America', electric: 'Deregulated', gas: 'Some deregulation', powerRateOptimization: 'Deregulated' },
  'Costa Rica': { region: 'Central America', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Some deregulation' },
  'Croatia': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Unlikely' },
  'Cuba': { region: 'Caribbean', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Cyprus': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'No opportunity' },
  'Czechia': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Democratic Republic of the Congo': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Denmark': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Djibouti': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Dominican Republic': { region: 'Caribbean', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'No opportunity' },
  'East Timor': { region: 'Southeast Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Ecuador': { region: 'South America', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Egypt': { region: 'North Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'El Salvador': { region: 'Central America', electric: 'Some deregulation', gas: 'Some deregulation', powerRateOptimization: 'Some deregulation' },
  'Equatorial Guinea': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Eritrea': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Estonia': { region: 'Europe', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Eswatini': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Ethiopia': { region: 'Africa', electric: 'Some deregulation', gas: 'No opportunity', powerRateOptimization: 'Unlikely' },
  'Finland': { region: 'Europe', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Some deregulation' },
  'France': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Gabon': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Gambia': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Georgia': { region: 'Europe/Asia', electric: 'No opportunity', gas: 'Some deregulation', powerRateOptimization: 'No opportunity' },
  'Germany': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Ghana': { region: 'Africa', electric: 'Some deregulation', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Greece': { region: 'Europe', electric: 'Unlikely', gas: 'Deregulated', powerRateOptimization: 'Unlikely' },
  'Greenland': { region: 'North America', electric: 'No opportunity', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Guatemala': { region: 'Central America', electric: 'Some deregulation', gas: 'Some deregulation', powerRateOptimization: 'Some deregulation' },
  'Guinea': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Guinea-Bissau': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Guyana': { region: 'South America', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Haiti': { region: 'Caribbean', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Honduras': { region: 'Central America', electric: 'Some deregulation', gas: 'Some deregulation', powerRateOptimization: 'Some deregulation' },
  'Hungary': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Unlikely' },
  'Iceland': { region: 'Europe', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'India': { region: 'South Asia', electric: 'Some deregulation', gas: 'Some deregulation', powerRateOptimization: 'Unlikely' },
  'Indonesia': { region: 'Southeast Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Iran': { region: 'Middle East', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Iraq': { region: 'Middle East', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Ireland': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Israel': { region: 'Middle East', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Italy': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Some deregulation' },
  'Ivory Coast': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Jamaica': { region: 'Caribbean', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'No opportunity' },
  'Japan': { region: 'East Asia', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Jordan': { region: 'Middle East', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Kazakhstan': { region: 'Central Asia', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Kenya': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Kosovo': { region: 'Europe', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Kuwait': { region: 'Middle East', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'Unlikely' },
  'Kyrgyzstan': { region: 'Central Asia', electric: 'Some deregulation', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Laos': { region: 'Southeast Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Latvia': { region: 'Europe', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Lebanon': { region: 'Middle East', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Lesotho': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Liberia': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Libya': { region: 'North Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Lithuania': { region: 'Europe', electric: 'Some deregulation', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Luxembourg': { region: 'Europe', electric: 'Some deregulation', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Madagascar': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Malawi': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Malaysia': { region: 'Southeast Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Mali': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Malta': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Mauritania': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Mexico': { region: 'North America', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Some deregulation' },
  'Moldova': { region: 'Europe', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Mongolia': { region: 'East Asia', electric: 'Some deregulation', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Montenegro': { region: 'Europe', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Morocco': { region: 'North Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Mozambique': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Myanmar': { region: 'Southeast Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Namibia': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Nepal': { region: 'South Asia', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Netherlands': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Some deregulation' },
  'New Zealand': { region: 'Oceania', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Nicaragua': { region: 'Central America', electric: 'Some deregulation', gas: 'Some deregulation', powerRateOptimization: 'Some deregulation' },
  'Niger': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Nigeria': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'North Korea': { region: 'East Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'North Macedonia': { region: 'Europe', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Norway': { region: 'Europe', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Some deregulation' },
  'Oman': { region: 'Middle East', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'Unlikely' },
  'Pakistan': { region: 'South Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Panama': { region: 'Central America', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Papua New Guinea': { region: 'Oceania', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Paraguay': { region: 'South America', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Peru': { region: 'South America', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Philippines': { region: 'Southeast Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Poland': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Portugal': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Unlikely' },
  'Qatar': { region: 'Middle East', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Republic of the Congo': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Romania': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Russia': { region: 'Europe/Asia', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Rwanda': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Saudi Arabia': { region: 'Middle East', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'Unlikely' },
  'Senegal': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Serbia': { region: 'Europe', electric: 'Some deregulation', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Sierra Leone': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Singapore': { region: 'Southeast Asia', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Slovakia': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Unlikely' },
  'Slovenia': { region: 'Europe', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Somalia': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'South Africa': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'South Korea': { region: 'East Asia', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'South Sudan': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Spain': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Sri Lanka': { region: 'South Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Sudan': { region: 'North Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Suriname': { region: 'South America', electric: 'No opportunity', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Sweden': { region: 'Europe', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Some deregulation' },
  'Switzerland': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Some deregulation' },
  'Syria': { region: 'Middle East', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Taiwan': { region: 'East Asia', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Tajikistan': { region: 'Central Asia', electric: 'Some deregulation', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Tanzania': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Unlikely' },
  'Thailand': { region: 'Southeast Asia', electric: 'Deregulated', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Togo': { region: 'Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Tunisia': { region: 'North Africa', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'No opportunity' },
  'Turkey': { region: 'Europe/Asia', electric: 'Deregulated', gas: 'Some deregulation', powerRateOptimization: 'Unlikely' },
  'Turkmenistan': { region: 'Central Asia', electric: 'Some deregulation', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Uganda': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Ukraine': { region: 'Europe', electric: 'Some deregulation', gas: 'Some deregulation', powerRateOptimization: 'Deregulated' },
  'United Arab Emirates': { region: 'Middle East', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'Unlikely' },
  'United Kingdom': { region: 'Europe', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'United States': { region: 'North America', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'Deregulated' },
  'Uruguay': { region: 'South America', electric: 'Deregulated', gas: 'Deregulated', powerRateOptimization: 'No opportunity' },
  'Uzbekistan': { region: 'Central Asia', electric: 'Some deregulation', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Venezuela': { region: 'South America', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'No opportunity' },
  'Vietnam': { region: 'Southeast Asia', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Deregulated' },
  'Yemen': { region: 'Middle East', electric: 'Unlikely', gas: 'No opportunity', powerRateOptimization: 'Unlikely' },
  'Zambia': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Some deregulation' },
  'Zimbabwe': { region: 'Africa', electric: 'Unlikely', gas: 'Unlikely', powerRateOptimization: 'Some deregulation' },
};

// Deregulated / Some deregulation → 2 - 4 % savings; everything else
// suppresses the commodity-savings motion. Stored as the same
// { range, lowPct, highPct } shape the US ELECTRIC_DEREGULATION /
// GAS_DEREGULATION maps use, so the export code can read either source
// through the same accessor.
const SAVINGS_BAND = {
  'Deregulated':       { range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  'Some deregulation': { range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  'Unlikely':          { range: '',       lowPct: null, highPct: null },
  'No opportunity':    { range: '',       lowPct: null, highPct: null },
};

// European markets don't carry a committed commodity-savings range yet,
// so we surface "TBD" instead of quoting the 2 - 4 % band — and no
// dollar savings (lowPct/highPct null) — wherever a range would
// otherwise apply. Scoped to every country whose region is "Europe" or
// "Europe/Asia", the same grouping the Europe View sheet uses. Markets
// that already earn no commodity savings (Unlikely / No opportunity)
// stay blank rather than flipping to TBD.
const TBD_BAND = { range: 'TBD', lowPct: null, highPct: null };

function isEuropeanRegion(region) {
  return String(region || '').startsWith('Europe');
}

// Resolves the commodity-savings band for a country bucket, applying
// the European TBD override on top of the status-driven SAVINGS_BAND.
function savingsBandFor(status, region) {
  const band = bandFor(status);
  if (band.lowPct != null && isEuropeanRegion(region)) return TBD_BAND;
  return band;
}

// Common alternate spellings of the country labels above. Keyed by
// case-folded / punctuation-stripped names so a sheet with "USA",
// "U.K.", "Czech Republic", etc. still resolves to the canonical row.
const NAME_ALIASES = {
  'usa': 'United States',
  'us': 'United States',
  'u s': 'United States',
  'u s a': 'United States',
  'united states of america': 'United States',
  'america': 'United States',
  'uk': 'United Kingdom',
  'u k': 'United Kingdom',
  'great britain': 'United Kingdom',
  'britain': 'United Kingdom',
  'england': 'United Kingdom',
  'scotland': 'United Kingdom',
  'wales': 'United Kingdom',
  'northern ireland': 'United Kingdom',
  'uae': 'United Arab Emirates',
  'u a e': 'United Arab Emirates',
  'emirates': 'United Arab Emirates',
  'czech republic': 'Czechia',
  'cote d ivoire': 'Ivory Coast',
  "cote d'ivoire": 'Ivory Coast',
  "côte d'ivoire": 'Ivory Coast',
  'timor leste': 'East Timor',
  'timor-leste': 'East Timor',
  'south korea': 'South Korea',
  'republic of korea': 'South Korea',
  'korea south': 'South Korea',
  'korea, republic of': 'South Korea',
  'north korea': 'North Korea',
  "democratic people's republic of korea": 'North Korea',
  'korea north': 'North Korea',
  'korea, democratic peoples republic of': 'North Korea',
  'congo democratic republic of the': 'Democratic Republic of the Congo',
  'congo, the democratic republic of the': 'Democratic Republic of the Congo',
  'dr congo': 'Democratic Republic of the Congo',
  'drc': 'Democratic Republic of the Congo',
  'congo kinshasa': 'Democratic Republic of the Congo',
  'congo brazzaville': 'Republic of the Congo',
  'congo': 'Republic of the Congo',
  'russia federation': 'Russia',
  'russian federation': 'Russia',
  'syrian arab republic': 'Syria',
  'iran islamic republic of': 'Iran',
  'lao': 'Laos',
  "lao people's democratic republic": 'Laos',
  'viet nam': 'Vietnam',
  'burma': 'Myanmar',
  'macedonia': 'North Macedonia',
  'swaziland': 'Eswatini',
  'holland': 'Netherlands',
  'the netherlands': 'Netherlands',
};

function canonicalKey(raw) {
  return String(raw).toLowerCase().replace(/[.,()]/g, '').replace(/\s+/g, ' ').trim();
}

// Returns the canonical country name from COUNTRY_DEREGULATION, or
// null when no match is possible. Tolerates the common ISO-style
// spellings the user's sheets tend to carry.
export function normalizeCountryName(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (COUNTRY_DEREGULATION[trimmed]) return trimmed;
  const key = canonicalKey(trimmed);
  const aliased = NAME_ALIASES[key];
  if (aliased && COUNTRY_DEREGULATION[aliased]) return aliased;
  // ISO 3166-1 alpha-3 ("CAN", "MEX", "TUN"). Tried after the name
  // aliases so a spelled-out country always wins the match.
  const iso3 = countryNameFromIso3(trimmed);
  if (iso3 && COUNTRY_DEREGULATION[iso3]) return iso3;
  for (const name of Object.keys(COUNTRY_DEREGULATION)) {
    if (canonicalKey(name) === key) return name;
  }
  return null;
}

export function countryDeregulation(rawCountry) {
  const name = normalizeCountryName(rawCountry);
  if (!name) return null;
  return COUNTRY_DEREGULATION[name];
}

function bandFor(status) {
  return SAVINGS_BAND[status] || SAVINGS_BAND['No opportunity'];
}

// Country-level savings band for the electric-commodity motion.
// Returns { status, range, lowPct, highPct } with lowPct/highPct null
// when the country isn't deregulated. Null when the country isn't on
// the reference list at all.
export function countryElectricSavings(rawCountry) {
  const d = countryDeregulation(rawCountry);
  if (!d) return null;
  return { status: d.electric, ...savingsBandFor(d.electric, d.region) };
}

export function countryGasSavings(rawCountry) {
  const d = countryDeregulation(rawCountry);
  if (!d) return null;
  return { status: d.gas, ...savingsBandFor(d.gas, d.region) };
}

// True when the country's Power Rate Optimization column is
// "Deregulated" or "Some deregulation" — the trigger for the regulated-
// rate motion (flat 0.25 % on regulated electric spend). Mirrors the
// US-side (state, utility) curated list; here it's country-level only.
export function countryHasRegulatedRateOpportunity(rawCountry) {
  const d = countryDeregulation(rawCountry);
  if (!d) return false;
  return d.powerRateOptimization === 'Deregulated'
      || d.powerRateOptimization === 'Some deregulation';
}
