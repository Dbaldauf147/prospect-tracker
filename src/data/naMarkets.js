// North America deregulation breakdown — the state-level Natural Gas /
// Electric Power regulation status each US state / Canadian province
// falls into. Drives the "Indicative Savings" Excel export (the
// State / Province deregulation status table + the per-site Electric
// Market / Gas Market columns) and the NA deregulation choropleth.
//
// This is the STATE-LEVEL view only. A recognized regulated utility
// (City of …, municipal, co-op, public power, etc. — see
// utilityClassify.js) still trumps this when the site's actual provider
// is known; this table is the fallback used when we're reasoning about
// the state as a whole.
//
// Each entry returns:
//   key   — stable enum (for switch/case)
//   label — human label combining the NG + EP status
//   ng    — Natural Gas status string (shown verbatim in the export)
//   ep    — Electric Power status string (shown verbatim in the export)
//   fill  — Excel ARGB cell fill colour (8-char hex, "FF" alpha + RRGGBB)
//   fg    — Excel ARGB text colour (8-char hex)
// Anything not listed defaults to "Regulated — NG & EP".
//
// ---------------------------------------------------------------------
// SOURCE OF TRUTH: this table is the DISPLAY layer. The authority on
// whether a market is competitive is ELECTRIC_DEREGULATION /
// GAS_DEREGULATION in components/SitesView/SitesView.jsx — those carry
// the indicative savings percentages, feed classifyMarket(), and decide
// the tier every Overview table counts by. This file only decides how
// that status is worded and coloured.
//
// The two once drifted apart, so the State / Province table read
// "Deregulated" for markets the Overview counted as limited (and vice
// versa) on the very same sheet. The assignments below are kept in step
// with those maps; the rule is:
//
//   dereg-map status         →  this table's status string
//   ------------------------    -------------------------------------
//   'yes'                    →  "Deregulated"
//   'Limited' (electric)     →  a "Deregulated – Limited Opportunity"
//   'Large load only' (gas)  →  wording (the specific caveat may name
//                               the restriction, as CA / MI / VA do)
//   absent from the map      →  "Regulated"
//
// A caveat that describes a *mechanism* rather than a restriction —
// Oregon's annual election period — still reads as fully deregulated
// and matches a 'yes'. When editing either side, re-check the other:
// the dereg maps decide the money, this file decides the wording, and
// they are expected to agree.
// ---------------------------------------------------------------------

export const NA_CATEGORIES = {
  REG_NG_EP: {
    key: 'REG_NG_EP',
    label: 'Regulated: NG & EP',
    ng: 'Regulated',
    ep: 'Regulated',
    fill: 'FF4AA3E0',
    fg:   'FFFFFFFF',
  },
  DEREG_NG: {
    key: 'DEREG_NG',
    label: 'Deregulated (NG; Regulated), EP',
    ng: 'Deregulated',
    ep: 'Regulated',
    fill: 'FF4CAF50',
    fg:   'FF14532D',
  },
  DEREG_NG_EP: {
    key: 'DEREG_NG_EP',
    label: 'Deregulated: NG & EP',
    ng: 'Deregulated',
    ep: 'Deregulated',
    fill: 'FF2E9E4F',
    fg:   'FFFFFFFF',
  },
  DEREG_LTD_NG: {
    key: 'DEREG_LTD_NG',
    label: 'Deregulated – Limited Opportunity (NG; Regulated), EP',
    ng: 'Deregulated – Limited Opportunity',
    ep: 'Regulated',
    fill: 'FFF2C200',
    fg:   'FF422006',
  },
  CA_DEREG_LOTTERY: {
    key: 'CA_DEREG_LOTTERY',
    label: 'Deregulated (NG; Deregulated (market cap + annual lottery)), EP',
    ng: 'Deregulated',
    ep: 'Deregulated (market cap + annual lottery eligibility)',
    fill: 'FFE8743B',
    fg:   'FFFFFFFF',
  },
  MI_DEREG_CAP: {
    key: 'MI_DEREG_CAP',
    label: 'Deregulated (NG; Deregulated with market cap), EP',
    ng: 'Deregulated',
    ep: 'Deregulated with market cap',
    fill: 'FF6B7280',
    fg:   'FFFFFFFF',
  },
  OR_DEREG_ELECTION: {
    key: 'OR_DEREG_ELECTION',
    label: 'Deregulated (NG; Deregulated with annual election period), EP',
    ng: 'Deregulated',
    ep: 'Deregulated with annual election period',
    fill: 'FF5B9BD5',
    fg:   'FFFFFFFF',
  },
  VA_DEREG_LTD_EP: {
    key: 'VA_DEREG_LTD_EP',
    label: 'Deregulated: NG; Deregulated – Limited Opportunity (5 MW min.): EP',
    ng: 'Deregulated',
    ep: 'Deregulated – Limited Opportunity (utility account must be 5 MW)',
    fill: 'FFD68910',
    fg:   'FFFFFFFF',
  },
  // Arizona: competitive gas market, but retail electric choice is gated
  // on the site already having had a third-party supplier. Same shape as
  // VA / CA / MI — deregulated gas, restricted electric — with the
  // caption naming Arizona's own restriction.
  AZ_DEREG_LTD_EP: {
    key: 'AZ_DEREG_LTD_EP',
    label: 'Deregulated: NG; Deregulated – Limited Opportunity (prior third-party supply): EP',
    ng: 'Deregulated',
    ep: 'Deregulated – Limited Opportunity (prior third-party supply required)',
    fill: 'FF9A6700',
    fg:   'FFFFFFFF',
  },
  // Alberta: fully competitive electric market, but gas retail choice is
  // large-load-only. The inverse of DEREG_LTD_NG, which pairs limited
  // gas with a regulated electric market.
  DEREG_LTD_NG_DEREG_EP: {
    key: 'DEREG_LTD_NG_DEREG_EP',
    label: 'Deregulated – Limited Opportunity (NG; Deregulated), EP',
    ng: 'Deregulated – Limited Opportunity',
    ep: 'Deregulated',
    fill: 'FF8FBF3F',
    fg:   'FF1A2E05',
  },
};

// US states + DC: full name + assigned category, mirroring the dereg
// maps named above. On the gas side that is a closed list: AL, ID, MS,
// MT, ND and SD are the only limited-opportunity states, Vermont is the
// only regulated one, and every other state plus DC is deregulated.
// Electric status varies independently and is unaffected by that rule.
export const US_MARKETS = [
  { code: 'AL', name: 'Alabama',         category: 'DEREG_LTD_NG' },
  { code: 'AK', name: 'Alaska',          category: 'DEREG_NG' },
  { code: 'AZ', name: 'Arizona',         category: 'AZ_DEREG_LTD_EP' },
  { code: 'AR', name: 'Arkansas',        category: 'DEREG_NG' },
  { code: 'CA', name: 'California',      category: 'CA_DEREG_LOTTERY' },
  { code: 'CO', name: 'Colorado',        category: 'DEREG_NG' },
  { code: 'CT', name: 'Connecticut',     category: 'DEREG_NG_EP' },
  { code: 'DC', name: 'District of Columbia', category: 'DEREG_NG_EP' },
  { code: 'DE', name: 'Delaware',        category: 'DEREG_NG_EP' },
  { code: 'FL', name: 'Florida',         category: 'DEREG_NG' },
  { code: 'GA', name: 'Georgia',         category: 'DEREG_NG' },
  { code: 'HI', name: 'Hawaii',          category: 'DEREG_NG' },
  { code: 'ID', name: 'Idaho',           category: 'DEREG_LTD_NG' },
  { code: 'IL', name: 'Illinois',        category: 'DEREG_NG_EP' },
  { code: 'IN', name: 'Indiana',         category: 'DEREG_NG' },
  { code: 'IA', name: 'Iowa',            category: 'DEREG_NG' },
  { code: 'KS', name: 'Kansas',          category: 'DEREG_NG' },
  { code: 'KY', name: 'Kentucky',        category: 'DEREG_NG' },
  { code: 'LA', name: 'Louisiana',       category: 'DEREG_NG' },
  { code: 'ME', name: 'Maine',           category: 'DEREG_NG_EP' },
  { code: 'MD', name: 'Maryland',        category: 'DEREG_NG_EP' },
  { code: 'MA', name: 'Massachusetts',   category: 'DEREG_NG_EP' },
  { code: 'MI', name: 'Michigan',        category: 'MI_DEREG_CAP' },
  { code: 'MN', name: 'Minnesota',       category: 'DEREG_NG' },
  { code: 'MS', name: 'Mississippi',     category: 'DEREG_LTD_NG' },
  { code: 'MO', name: 'Missouri',        category: 'DEREG_NG' },
  { code: 'MT', name: 'Montana',         category: 'DEREG_LTD_NG' },
  { code: 'NE', name: 'Nebraska',        category: 'DEREG_NG' },
  { code: 'NV', name: 'Nevada',          category: 'DEREG_NG' },
  { code: 'NH', name: 'New Hampshire',   category: 'DEREG_NG_EP' },
  { code: 'NJ', name: 'New Jersey',      category: 'DEREG_NG_EP' },
  { code: 'NM', name: 'New Mexico',      category: 'DEREG_NG' },
  { code: 'NY', name: 'New York',        category: 'DEREG_NG_EP' },
  { code: 'NC', name: 'North Carolina',  category: 'DEREG_NG' },
  { code: 'ND', name: 'North Dakota',    category: 'DEREG_LTD_NG' },
  { code: 'OH', name: 'Ohio',            category: 'DEREG_NG_EP' },
  { code: 'OK', name: 'Oklahoma',        category: 'DEREG_NG' },
  { code: 'OR', name: 'Oregon',          category: 'OR_DEREG_ELECTION' },
  { code: 'PA', name: 'Pennsylvania',    category: 'DEREG_NG_EP' },
  { code: 'RI', name: 'Rhode Island',    category: 'DEREG_NG_EP' },
  { code: 'SC', name: 'South Carolina',  category: 'DEREG_NG' },
  { code: 'SD', name: 'South Dakota',    category: 'DEREG_LTD_NG' },
  { code: 'TN', name: 'Tennessee',       category: 'DEREG_NG' },
  { code: 'TX', name: 'Texas',           category: 'DEREG_NG_EP' },
  { code: 'UT', name: 'Utah',            category: 'DEREG_NG' },
  { code: 'VT', name: 'Vermont',         category: 'REG_NG_EP' },
  { code: 'VA', name: 'Virginia',        category: 'VA_DEREG_LTD_EP' },
  { code: 'WA', name: 'Washington',      category: 'DEREG_NG' },
  { code: 'WV', name: 'West Virginia',   category: 'DEREG_NG' },
  { code: 'WI', name: 'Wisconsin',       category: 'DEREG_NG' },
  { code: 'WY', name: 'Wyoming',         category: 'DEREG_NG' },
];

// Canadian provinces + territories.
export const CA_MARKETS = [
  { code: 'AB', name: 'Alberta',                  category: 'DEREG_LTD_NG_DEREG_EP' },
  { code: 'BC', name: 'British Columbia',         category: 'DEREG_LTD_NG' },
  { code: 'MB', name: 'Manitoba',                 category: 'DEREG_LTD_NG' },
  { code: 'NB', name: 'New Brunswick',            category: 'DEREG_NG' },
  { code: 'NL', name: 'Newfoundland and Labrador',category: 'REG_NG_EP' },
  { code: 'NS', name: 'Nova Scotia',              category: 'REG_NG_EP' },
  { code: 'NT', name: 'Northwest Territories',    category: 'REG_NG_EP' },
  { code: 'NU', name: 'Nunavut',                  category: 'REG_NG_EP' },
  { code: 'ON', name: 'Ontario',                  category: 'DEREG_NG_EP' },
  { code: 'PE', name: 'Prince Edward Island',     category: 'REG_NG_EP' },
  { code: 'QC', name: 'Québec',                   category: 'DEREG_NG' },
  { code: 'SK', name: 'Saskatchewan',             category: 'DEREG_NG' },
  { code: 'YT', name: 'Yukon',                    category: 'REG_NG_EP' },
];

// Map a free-text Canadian province / territory value to its 2-letter
// postal code: a code already ("ON"), a full name ("Ontario"), or an
// accented / aliased variant ("Québec", "Quebec", "Newfoundland"). Returns
// null when nothing matches. This mirrors normalizeState (which is US-only)
// so Canadian sites resolve to the codes the province-centre table and the
// admin-1 map polygons key on, instead of staying as raw province names.
const _PROVINCE_CODES = new Set(CA_MARKETS.map(m => m.code));
const _PROVINCE_NAME_TO_CODE = (() => {
  const m = {};
  for (const { code, name } of CA_MARKETS) m[name.toLowerCase()] = code;
  // Common aliases / unaccented + shorthand variants beyond the
  // canonical names above (the only accented name is "Québec").
  return Object.assign(m, {
    'quebec': 'QC',
    'newfoundland': 'NL',
    'newfoundland & labrador': 'NL',
    'labrador': 'NL',
    'pei': 'PE',
    'nwt': 'NT',
    'yukon territory': 'YT',
  });
})();
export function normalizeProvince(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const code2 = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (code2.length === 2 && _PROVINCE_CODES.has(code2)) return code2;
  const key = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return _PROVINCE_NAME_TO_CODE[key] || null;
}

export function naCategoryFor(stateCode, isUS, isCA) {
  if (!stateCode) return null;
  const code = String(stateCode).toUpperCase();
  if (isUS) {
    const row = US_MARKETS.find(m => m.code === code);
    return row ? NA_CATEGORIES[row.category] : null;
  }
  if (isCA) {
    const row = CA_MARKETS.find(m => m.code === code);
    return row ? NA_CATEGORIES[row.category] : null;
  }
  return null;
}
