// North America deregulation breakdown — the rich category each US
// state / Canadian province falls into for the "Indicative Savings"
// Excel export's North America Markets sheet. Matches the legend on
// the Schneider Electric US/Canada deregulation map.
//
// Each entry returns:
//   key   — stable enum (for switch/case)
//   label — human label as it appears in the map legend
//   ng    — short label for the Natural Gas status
//   ep    — short label for the Electric Power status
//   fill  — Excel ARGB cell fill colour (8-char hex, "FF" alpha + RRGGBB)
//   fg    — Excel ARGB text colour (8-char hex)
// Anything not listed defaults to "Regulated – NG & EP".

export const NA_CATEGORIES = {
  REG_NG_EP: {
    key: 'REG_NG_EP',
    label: 'Regulated — NG & EP',
    ng: 'Regulated',
    ep: 'Regulated',
    fill: 'FFD1D5DB',
    fg:   'FF1F2937',
  },
  DEREG_NG: {
    key: 'DEREG_NG',
    label: 'Deregulated — NG',
    ng: 'Deregulated',
    ep: 'Regulated',
    fill: 'FF166534',
    fg:   'FFFFFFFF',
  },
  DEREG_NG_EP: {
    key: 'DEREG_NG_EP',
    label: 'Deregulated — NG & EP',
    ng: 'Deregulated',
    ep: 'Deregulated',
    fill: 'FF4ADE80',
    fg:   'FF14532D',
  },
  DEREG_NG_LIMITED_EP: {
    key: 'DEREG_NG_LIMITED_EP',
    label: 'Deregulated — NG; Limited Deregulation — EP',
    ng: 'Deregulated',
    ep: 'Limited Deregulation',
    fill: 'FFEAB308',
    fg:   'FF422006',
  },
  DEREG_NG_HEAVY_EP: {
    key: 'DEREG_NG_HEAVY_EP',
    label: 'Deregulated — NG; Heavy Energy Users Only (5-10 MW min.) — EP',
    ng: 'Deregulated',
    ep: 'Heavy Energy Users Only (5-10 MW min.)',
    fill: 'FFEA580C',
    fg:   'FFFFFFFF',
  },
  LIMITED_EP: {
    key: 'LIMITED_EP',
    label: 'Limited Deregulation — EP (NG regulated)',
    ng: 'Regulated',
    ep: 'Limited Deregulation',
    fill: 'FFE5E7EB',
    fg:   'FF1F2937',
  },
  DIRECT_ACCESS_EP: {
    key: 'DIRECT_ACCESS_EP',
    label: 'Limited to those w/ Direct Access Rights — EP',
    ng: 'Regulated',
    ep: 'Direct Access Rights only',
    fill: 'FF9CA3AF',
    fg:   'FF111827',
  },
  HEAVY_EP: {
    key: 'HEAVY_EP',
    label: 'Heavy Energy Users Only (5-10 MW min.) — EP',
    ng: 'Regulated',
    ep: 'Heavy Energy Users Only (5-10 MW min.)',
    fill: 'FF111827',
    fg:   'FFFFFFFF',
  },
  // Canada-specific bucket combinations.
  CA_LIMITED_NG_DEREG_EP: {
    key: 'CA_LIMITED_NG_DEREG_EP',
    label: 'Limited Deregulation — NG; Deregulated — EP',
    ng: 'Limited Deregulation',
    ep: 'Deregulated',
    fill: 'FF38BDF8',
    fg:   'FF0C4A6E',
  },
  CA_LIMITED_NG_REG_EP: {
    key: 'CA_LIMITED_NG_REG_EP',
    label: 'Limited Deregulation — NG; Regulated — EP',
    ng: 'Limited Deregulation',
    ep: 'Regulated',
    fill: 'FFBE185D',
    fg:   'FFFFFFFF',
  },
};

// US states + DC: full name + assigned category. Categories were
// taken from the Schneider Electric "US Natural Gas & Electric
// Power Deregulation" reference map.
export const US_MARKETS = [
  { code: 'AL', name: 'Alabama',         category: 'REG_NG_EP' },
  { code: 'AK', name: 'Alaska',          category: 'REG_NG_EP' },
  { code: 'AZ', name: 'Arizona',         category: 'HEAVY_EP' },
  { code: 'AR', name: 'Arkansas',        category: 'REG_NG_EP' },
  { code: 'CA', name: 'California',      category: 'DIRECT_ACCESS_EP' },
  { code: 'CO', name: 'Colorado',        category: 'DEREG_NG' },
  { code: 'CT', name: 'Connecticut',     category: 'DEREG_NG_EP' },
  { code: 'DC', name: 'District of Columbia', category: 'DEREG_NG_EP' },
  { code: 'DE', name: 'Delaware',        category: 'DEREG_NG_EP' },
  { code: 'FL', name: 'Florida',         category: 'DEREG_NG' },
  { code: 'GA', name: 'Georgia',         category: 'DEREG_NG' },
  { code: 'HI', name: 'Hawaii',          category: 'REG_NG_EP' },
  { code: 'ID', name: 'Idaho',           category: 'DEREG_NG' },
  { code: 'IL', name: 'Illinois',        category: 'DEREG_NG_EP' },
  { code: 'IN', name: 'Indiana',         category: 'DEREG_NG' },
  { code: 'IA', name: 'Iowa',            category: 'DEREG_NG' },
  { code: 'KS', name: 'Kansas',          category: 'DEREG_NG' },
  { code: 'KY', name: 'Kentucky',        category: 'DEREG_NG' },
  { code: 'LA', name: 'Louisiana',       category: 'DEREG_NG' },
  { code: 'ME', name: 'Maine',           category: 'DEREG_NG_EP' },
  { code: 'MD', name: 'Maryland',        category: 'DEREG_NG_EP' },
  { code: 'MA', name: 'Massachusetts',   category: 'DEREG_NG_EP' },
  { code: 'MI', name: 'Michigan',        category: 'DEREG_NG_LIMITED_EP' },
  { code: 'MN', name: 'Minnesota',       category: 'REG_NG_EP' },
  { code: 'MS', name: 'Mississippi',     category: 'DEREG_NG' },
  { code: 'MO', name: 'Missouri',        category: 'DEREG_NG' },
  { code: 'MT', name: 'Montana',         category: 'DEREG_NG' },
  { code: 'NE', name: 'Nebraska',        category: 'DEREG_NG' },
  { code: 'NV', name: 'Nevada',          category: 'REG_NG_EP' },
  { code: 'NH', name: 'New Hampshire',   category: 'DEREG_NG_EP' },
  { code: 'NJ', name: 'New Jersey',      category: 'DEREG_NG_EP' },
  { code: 'NM', name: 'New Mexico',      category: 'DEREG_NG' },
  { code: 'NY', name: 'New York',        category: 'DEREG_NG_EP' },
  { code: 'NC', name: 'North Carolina',  category: 'DEREG_NG' },
  { code: 'ND', name: 'North Dakota',    category: 'DEREG_NG' },
  { code: 'OH', name: 'Ohio',            category: 'DEREG_NG_EP' },
  { code: 'OK', name: 'Oklahoma',        category: 'DEREG_NG' },
  { code: 'OR', name: 'Oregon',          category: 'DEREG_NG_LIMITED_EP' },
  { code: 'PA', name: 'Pennsylvania',    category: 'DEREG_NG_EP' },
  { code: 'RI', name: 'Rhode Island',    category: 'DEREG_NG_EP' },
  { code: 'SC', name: 'South Carolina',  category: 'DEREG_NG' },
  { code: 'SD', name: 'South Dakota',    category: 'DEREG_NG' },
  { code: 'TN', name: 'Tennessee',       category: 'DEREG_NG' },
  { code: 'TX', name: 'Texas',           category: 'DEREG_NG_EP' },
  { code: 'UT', name: 'Utah',            category: 'DEREG_NG' },
  { code: 'VT', name: 'Vermont',         category: 'REG_NG_EP' },
  { code: 'VA', name: 'Virginia',        category: 'DEREG_NG_HEAVY_EP' },
  { code: 'WA', name: 'Washington',      category: 'LIMITED_EP' },
  { code: 'WV', name: 'West Virginia',   category: 'DEREG_NG' },
  { code: 'WI', name: 'Wisconsin',       category: 'DEREG_NG' },
  { code: 'WY', name: 'Wyoming',         category: 'DEREG_NG' },
];

// Canadian provinces + territories. Categories taken from the
// Schneider Electric Canada deregulation reference map.
export const CA_MARKETS = [
  { code: 'AB', name: 'Alberta',                  category: 'CA_LIMITED_NG_REG_EP' },
  { code: 'BC', name: 'British Columbia',         category: 'CA_LIMITED_NG_DEREG_EP' },
  { code: 'MB', name: 'Manitoba',                 category: 'DEREG_NG' },
  { code: 'NB', name: 'New Brunswick',            category: 'REG_NG_EP' },
  { code: 'NL', name: 'Newfoundland and Labrador',category: 'REG_NG_EP' },
  { code: 'NS', name: 'Nova Scotia',              category: 'REG_NG_EP' },
  { code: 'NT', name: 'Northwest Territories',    category: 'REG_NG_EP' },
  { code: 'NU', name: 'Nunavut',                  category: 'REG_NG_EP' },
  { code: 'ON', name: 'Ontario',                  category: 'DEREG_NG_EP' },
  { code: 'PE', name: 'Prince Edward Island',     category: 'REG_NG_EP' },
  { code: 'QC', name: 'Québec',                   category: 'DEREG_NG_EP' },
  { code: 'SK', name: 'Saskatchewan',             category: 'DEREG_NG' },
  { code: 'YT', name: 'Yukon',                    category: 'REG_NG_EP' },
];

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
