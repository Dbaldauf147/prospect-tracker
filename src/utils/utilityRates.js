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

// Detect plausible consumption columns. We match in tiers so the
// strongest signals win and weaker ones only apply when nothing
// better exists — critical when the sheet has a real "Annual kWh"
// column alongside an "Energy Star Score = 1". Without tiering, the
// conservative-min picker would grab the 1 and wipe out the real
// 5,400,000 kWh value.
//
//   Tier A: header carries an explicit energy/gas unit (kWh, MWh,
//           GWh, therms, MMBtu, Mcf, Ccf, BTU). Rock-solid signal.
//   Tier B: header has a consumption/usage keyword paired with the
//           commodity word (Electric Usage, Gas Consumption).
//   Tier C: just the commodity word (Electric, Gas, Power, Energy)
//           — last-resort fallback, ignored when A or B found
//           anything.
export function detectConsumptionColumns(headers, commodity) {
  if (!headers?.length) return [];
  const unitsElectric = /\b(kwh|mwh|gwh)\b/i;
  const unitsGas = /\b(therms?|mmbtu|mcf|ccf|btu|dth|dekatherm|decatherm)\b/i;
  const unitPat = commodity === 'electric' ? unitsElectric : unitsGas;

  const commodityWord = commodity === 'electric'
    ? /\b(electric(ity|al)?|power|energy|elec)\b/i
    : /\b(natural\s*gas|gas|ng)\b/i;

  const consumptionKeyword = /\b(consumption|usage|use|demand|annual|yearly|baseline|estimate(d)?|min|max|low|high|p50|p90|forecast|load)\b/i;

  // Column names we don't want to ever match even if they contain
  // energy words — these are where the 1's and 10's live.
  const EXCLUDE = /\b(rate|cost|price|tariff|spend|bill|per|\$|usd|category|type|status|notes?|fit|score|rating|rank|tier|year|acquired|name|company|city|state|zip|country|address|id|count|sites?|opportunity|meter(s)?|intensity|sqft|sqm|density|%|percent|pct|index|ratio|number\s*of|num\s+|flag|has\b|yes|no|grade|star)\b/i;
  // Intensity columns (kWh/sqft, therms/unit, $/unit) have a slash
  // between units — also shouldn't count as total consumption.
  const LOOKS_LIKE_INTENSITY = /\/\s*(sq\s*ft|sqft|sf|sqm|m2|unit|bldg|building|hr|hour|day|month|mo\.|m\b)/i;

  const tiered = { A: new Set(), B: new Set(), C: new Set() };
  for (const h of headers) {
    const s = String(h);
    if (!s.trim()) continue;
    if (EXCLUDE.test(s)) continue;
    if (LOOKS_LIKE_INTENSITY.test(s)) continue;
    if (unitPat.test(s)) { tiered.A.add(h); continue; }
    if (commodityWord.test(s) && consumptionKeyword.test(s)) { tiered.B.add(h); continue; }
    if (commodityWord.test(s)) { tiered.C.add(h); continue; }
  }
  if (tiered.A.size > 0) return [...tiered.A];
  if (tiered.B.size > 0) return [...tiered.B];
  return [...tiered.C];
}

// Backwards-compat convenience for callers that only want the first
// match — returns the header or ''.
export function detectConsumptionColumn(headers, commodity) {
  return detectConsumptionColumns(headers, commodity)[0] || '';
}

// Normalize a free-form unit-of-measure string (typed by the user
// into an "Electric UoM" / "Gas UoM" column, or chosen from the
// template's data-validation dropdown) to the canonical token that
// toKwh / toTherms expect. Returns '' when the input is blank or
// unrecognized, letting the caller fall back to header-detected
// units instead of silently treating the value as the wrong unit.
export function normalizeElectricUom(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/\bgwh\b|gigawatt/.test(s)) return 'GWh';
  if (/\bmwh\b|megawatt/.test(s)) return 'MWh';
  if (/\bkwh\b|kilowatt/.test(s)) return 'kWh';
  return '';
}
export function normalizeGasUom(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/\b(dth|dekatherm|decatherm)\b/.test(s)) return 'Dth';
  if (/\bmmbtu\b/.test(s)) return 'MMBtu';
  if (/\bmcf\b/.test(s)) return 'Mcf';
  if (/\bccf\b/.test(s)) return 'Ccf';
  if (/\bbtu\b/.test(s) && !/mmbtu/.test(s)) return 'BTU';
  if (/\btherms?\b/.test(s)) return 'therms';
  return '';
}

// Detect the unit of a consumption column so we can convert to the
// table's canonical unit ($/kWh × kWh for electric, $/therm × therms
// for gas). Defaults to the canonical unit when the header is quiet.
export function detectConsumptionUnit(header, commodity) {
  const h = String(header || '').toLowerCase();
  if (commodity === 'electric') {
    if (/\bgwh\b/.test(h)) return 'GWh';
    if (/\bmwh\b/.test(h)) return 'MWh';
    return 'kWh';
  }
  if (/\b(dth|dekatherm|decatherm)\b/.test(h)) return 'Dth';
  if (/\bmmbtu\b/.test(h)) return 'MMBtu';
  if (/\bmcf\b/.test(h)) return 'Mcf';
  if (/\bccf\b/.test(h)) return 'Ccf';
  if (/\bbtu\b/.test(h) && !/mmbtu/i.test(h)) return 'BTU';
  return 'therms';
}

// Forgiving numeric parse — accepts numbers, numeric strings with
// thousands separators ("458,234"), trailing unit text ("458,234
// kWh"), or leading currency-ish noise. Returns NaN only for truly
// unparseable input.
function looseNumber(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return value;
  const raw = String(value).trim();
  if (!raw) return NaN;
  // Strip anything that isn't a digit, minus, or decimal point. Matches
  // "458,234", "1.2M kWh", "~4,500 therms", etc. Ignores scientific
  // notation, which is rare in these sheets.
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return NaN;
  // Expand common magnitude shorthand baked into the cell.
  if (/\bm(illion)?\b/i.test(raw) || /\bM\b/.test(raw)) return n * 1_000_000;
  if (/\bk\b/i.test(raw) || /\bthousand\b/i.test(raw)) return n * 1_000;
  return n;
}

export function toKwh(value, unit) {
  const n = looseNumber(value);
  if (!Number.isFinite(n)) return null;
  switch (unit) {
    case 'GWh': return n * 1_000_000;
    case 'MWh': return n * 1_000;
    case 'kWh':
    default:    return n;
  }
}

export function toTherms(value, unit) {
  const n = looseNumber(value);
  if (!Number.isFinite(n)) return null;
  switch (unit) {
    case 'Dth':   return n * 10;        // 1 dekatherm = 10 therms = 1 MMBtu
    case 'MMBtu': return n * 10;        // 1 MMBtu = 10 therms
    case 'Mcf':   return n * 10.37;     // 1 Mcf ≈ 10.37 therms (US avg heating value)
    case 'Ccf':   return n * 1.037;
    case 'BTU':   return n / 100_000;   // 1 therm = 100,000 BTU
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
