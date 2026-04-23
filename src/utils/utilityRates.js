// Indicative commercial-sector utility rates by US state, plus the
// rate-derivation helpers used on the Utility Lookup page to estimate
// annual cost per site.
//
// Electric rates are in $/kWh, gas rates are in $/therm. Numbers are
// approximate 2024 EIA commercial averages — close enough for
// "indicative" back-of-napkin costing, but nowhere near tariff-level
// accurate, especially for regulated muni / coop customers. The user
// can layer overrides on top later.

export const STATE_RATES = {
  // { electric: $/kWh, gas: $/therm }
  AL: { electric: 0.128, gas: 1.08 },
  AK: { electric: 0.238, gas: 0.96 },
  AZ: { electric: 0.109, gas: 1.03 },
  AR: { electric: 0.095, gas: 0.92 },
  CA: { electric: 0.225, gas: 1.43 },
  CO: { electric: 0.114, gas: 0.92 },
  CT: { electric: 0.200, gas: 1.24 },
  DE: { electric: 0.113, gas: 1.11 },
  DC: { electric: 0.135, gas: 1.00 },
  FL: { electric: 0.115, gas: 1.09 },
  GA: { electric: 0.109, gas: 1.19 },
  HI: { electric: 0.401, gas: 4.64 },
  ID: { electric: 0.093, gas: 0.79 },
  IL: { electric: 0.111, gas: 0.86 },
  IN: { electric: 0.113, gas: 0.88 },
  IA: { electric: 0.093, gas: 0.89 },
  KS: { electric: 0.118, gas: 0.82 },
  KY: { electric: 0.110, gas: 0.87 },
  LA: { electric: 0.104, gas: 0.80 },
  ME: { electric: 0.182, gas: 1.24 },
  MD: { electric: 0.124, gas: 1.11 },
  MA: { electric: 0.227, gas: 1.38 },
  MI: { electric: 0.123, gas: 0.88 },
  MN: { electric: 0.119, gas: 0.82 },
  MS: { electric: 0.110, gas: 0.96 },
  MO: { electric: 0.107, gas: 1.04 },
  MT: { electric: 0.109, gas: 0.85 },
  NE: { electric: 0.099, gas: 0.87 },
  NV: { electric: 0.116, gas: 0.97 },
  NH: { electric: 0.198, gas: 1.21 },
  NJ: { electric: 0.152, gas: 1.14 },
  NM: { electric: 0.104, gas: 0.81 },
  NY: { electric: 0.183, gas: 1.11 },
  NC: { electric: 0.098, gas: 1.03 },
  ND: { electric: 0.102, gas: 0.89 },
  OH: { electric: 0.107, gas: 0.86 },
  OK: { electric: 0.095, gas: 0.82 },
  OR: { electric: 0.111, gas: 0.94 },
  PA: { electric: 0.110, gas: 0.99 },
  RI: { electric: 0.208, gas: 1.15 },
  SC: { electric: 0.114, gas: 1.14 },
  SD: { electric: 0.104, gas: 0.85 },
  TN: { electric: 0.111, gas: 0.96 },
  TX: { electric: 0.099, gas: 0.89 },
  UT: { electric: 0.094, gas: 0.76 },
  VT: { electric: 0.183, gas: 1.13 },
  VA: { electric: 0.097, gas: 1.14 },
  WA: { electric: 0.099, gas: 0.96 },
  WV: { electric: 0.108, gas: 1.01 },
  WI: { electric: 0.117, gas: 0.83 },
  WY: { electric: 0.100, gas: 0.92 },
};

// US zip-prefix → state. Keyed by the first 3 digits of the ZIP. Most
// prefixes map cleanly; the handful that straddle borders default to
// the dominant state — indicative, not authoritative.
const ZIP_PREFIX_TO_STATE = (() => {
  const map = new Map();
  function add(start, end, state) {
    for (let i = start; i <= end; i++) map.set(String(i).padStart(3, '0'), state);
  }
  add(0, 0, 'PR');
  add(5, 9, 'PR'); // US Virgin Islands + PR territory prefixes
  add(10, 27, 'MA');
  add(28, 29, 'RI');
  add(30, 38, 'NH');
  add(39, 49, 'ME');
  add(50, 59, 'VT');
  add(60, 69, 'CT');
  add(70, 89, 'NJ');
  add(90, 99, 'APO'); // Military
  add(100, 149, 'NY');
  add(150, 196, 'PA');
  add(197, 199, 'DE');
  add(200, 205, 'DC');
  add(206, 219, 'MD');
  add(220, 246, 'VA');
  add(247, 268, 'WV');
  add(270, 289, 'NC');
  add(290, 299, 'SC');
  add(300, 319, 'GA');
  add(320, 349, 'FL');
  add(350, 369, 'AL');
  add(370, 385, 'TN');
  add(386, 397, 'MS');
  add(398, 399, 'GA');
  add(400, 427, 'KY');
  add(430, 458, 'OH');
  add(459, 479, 'IN'); // some OH overlap but IN dominates
  add(480, 499, 'MI');
  add(500, 528, 'IA');
  add(530, 549, 'WI');
  add(550, 567, 'MN');
  add(570, 577, 'SD');
  add(580, 588, 'ND');
  add(590, 599, 'MT');
  add(600, 629, 'IL');
  add(630, 658, 'MO');
  add(660, 679, 'KS');
  add(680, 693, 'NE');
  add(700, 714, 'LA');
  add(716, 729, 'AR');
  add(730, 749, 'OK');
  add(750, 799, 'TX');
  add(800, 816, 'CO');
  add(820, 831, 'WY');
  add(832, 838, 'ID');
  add(840, 847, 'UT');
  add(850, 865, 'AZ');
  add(870, 884, 'NM');
  add(889, 898, 'NV');
  add(900, 961, 'CA');
  add(967, 968, 'HI');
  add(970, 979, 'OR');
  add(980, 994, 'WA');
  add(995, 999, 'AK');
  return map;
})();

export function zipToState(zip) {
  if (!zip) return null;
  const key = String(zip).trim().slice(0, 3).padStart(3, '0');
  return ZIP_PREFIX_TO_STATE.get(key) || null;
}

// Infer a US state from a free-text state value like "New York" or
// "n.y." or an already-2-letter code. Returns a 2-letter code or null.
const STATE_NAME_TO_CODE = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
export function normalizeState(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (upper.length === 2 && STATE_RATES[upper]) return upper;
  const key = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const code = STATE_NAME_TO_CODE[key];
  return code || null;
}

// Detect ALL plausible consumption columns for a commodity so we can
// pick the most conservative value per site when the source file
// includes multiple estimates (e.g. "Electric kWh Min" + "Electric
// kWh Max", or "Estimated kWh" + "Benchmark kWh").
export function detectConsumptionColumns(headers, commodity) {
  if (!headers?.length) return [];
  const patterns = commodity === 'electric'
    ? [
        /^kwh$/i,
        /\bkwh\b/i,
        /\bmwh\b/i,
        /annual.*(electric|kwh|power)/i,
        /(electric|power).*(consum|usage|use|demand|annual|estimate|baseline|low|high|min|max|p50|p90)/i,
      ]
    : [
        /^therms?$/i,
        /\btherms?\b/i,
        /\bmmbtu\b/i,
        /\bmcf\b/i,
        /\bccf\b/i,
        /(gas|natural\s*gas).*(consum|usage|use|annual|estimate|baseline|low|high|min|max|p50|p90)/i,
        /annual.*(gas|natural\s*gas)/i,
      ];
  const found = new Set();
  for (const h of headers) {
    for (const pat of patterns) {
      if (pat.test(String(h))) { found.add(h); break; }
    }
  }
  return [...found];
}

// Backwards-compat convenience for callers that only want the first
// match — returns the header or ''.
export function detectConsumptionColumn(headers, commodity) {
  return detectConsumptionColumns(headers, commodity)[0] || '';
}

// Detect the unit of a consumption column so we can convert to the
// table's canonical unit ($/kWh × kWh for electric, $/therm × therms
// for gas). Defaults to the canonical unit when the header is quiet.
export function detectConsumptionUnit(header, commodity) {
  const h = String(header || '').toLowerCase();
  if (commodity === 'electric') {
    if (/\bmwh\b/.test(h)) return 'MWh';
    return 'kWh';
  }
  if (/\bmmbtu\b/.test(h)) return 'MMBtu';
  if (/\bmcf\b/.test(h)) return 'Mcf';
  if (/\bccf\b/.test(h)) return 'Ccf';
  return 'therms';
}

export function toKwh(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  switch (unit) {
    case 'MWh': return n * 1000;
    case 'kWh':
    default: return n;
  }
}

export function toTherms(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  switch (unit) {
    case 'MMBtu': return n * 10;        // 1 MMBtu = 10 therms
    case 'Mcf':   return n * 10.37;     // 1 Mcf ≈ 10.37 therms (US avg heating value)
    case 'Ccf':   return n * 1.037;
    case 'therms':
    default:      return n;
  }
}

export function stateRate(state, commodity) {
  if (!state) return null;
  const row = STATE_RATES[state];
  if (!row) return null;
  return row[commodity] ?? null;
}

export function formatMoney(value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

export function formatRate(value, commodity) {
  if (value == null || !Number.isFinite(value)) return null;
  if (commodity === 'electric') return `$${value.toFixed(3)}/kWh`;
  return `$${value.toFixed(2)}/therm`;
}
