// Indicative utility rates by US state, split by customer segment
// (commercial vs industrial), plus the rate-derivation helpers used on
// the Utility Lookup page to estimate annual cost per site.
//
// Each state carries electric ($/kWh) and gas ($/therm) figures, and
// each commodity carries a `commercial` and an `industrial` average.
// Numbers are EIA commercial / industrial sector averages — close
// enough for "indicative" back-of-napkin costing, but nowhere near
// tariff-level accurate, especially for regulated muni / coop
// customers. The site's segment (see propertyTypeSegment) selects
// which column applies; industrial falls back to commercial when an
// industrial figure is missing (e.g. DC has no industrial gas value).
export const STATE_RATES = {
  // { electric: { commercial, industrial } $/kWh, gas: { commercial, industrial } $/therm }
  AL: { electric: { commercial: 0.1307, industrial: 0.0692 }, gas: { commercial: 1.3365, industrial: 1.0386 } },
  AK: { electric: { commercial: 0.2087, industrial: 0.1870 }, gas: { commercial: 1.1716, industrial: 0.7300 } },
  AZ: { electric: { commercial: 0.1179, industrial: 0.0811 }, gas: { commercial: 0.9344, industrial: 0.4311 } },
  AR: { electric: { commercial: 0.1036, industrial: 0.0630 }, gas: { commercial: 1.2015, industrial: 0.9759 } },
  CA: { electric: { commercial: 0.2391, industrial: 0.1864 }, gas: { commercial: 1.5709, industrial: 1.3867 } },
  CO: { electric: { commercial: 0.1164, industrial: 0.0850 }, gas: { commercial: 0.9373, industrial: 0.8361 } },
  CT: { electric: { commercial: 0.1999, industrial: 0.1569 }, gas: { commercial: 1.2237, industrial: 0.8689 } },
  DE: { electric: { commercial: 0.1220, industrial: 0.0930 }, gas: { commercial: 1.2748, industrial: 1.2141 } },
  DC: { electric: { commercial: 0.1518, industrial: 0.1200 }, gas: { commercial: 1.5680, industrial: null } },
  FL: { electric: { commercial: 0.1085, industrial: 0.0840 }, gas: { commercial: 1.2459, industrial: 0.4889 } },
  GA: { electric: { commercial: 0.1149, industrial: 0.0680 }, gas: { commercial: 1.1427, industrial: 1.1418 } },
  HI: { electric: { commercial: 0.3903, industrial: 0.3528 }, gas: { commercial: 4.3288, industrial: 3.3230 } },
  ID: { electric: { commercial: 0.0878, industrial: 0.0717 }, gas: { commercial: 0.6201, industrial: 0.4108 } },
  IL: { electric: { commercial: 0.1124, industrial: 0.0820 }, gas: { commercial: 1.0145, industrial: 0.8293 } },
  IN: { electric: { commercial: 0.1255, industrial: 0.0824 }, gas: { commercial: 0.8997, industrial: 0.7445 } },
  IA: { electric: { commercial: 0.1033, industrial: 0.0691 }, gas: { commercial: 0.9720, industrial: 0.9942 } },
  KS: { electric: { commercial: 0.1085, industrial: 0.0764 }, gas: { commercial: 1.1880, industrial: 0.7425 } },
  KY: { electric: { commercial: 0.1096, industrial: 0.0680 }, gas: { commercial: 1.3356, industrial: 0.8708 } },
  LA: { electric: { commercial: 0.1041, industrial: 0.0588 }, gas: { commercial: 1.3645, industrial: 0.8775 } },
  ME: { electric: { commercial: 0.1788, industrial: 0.1230 }, gas: { commercial: 1.5063, industrial: 0.9961 } },
  MD: { electric: { commercial: 0.1293, industrial: 0.0980 }, gas: { commercial: 1.4243, industrial: 1.4658 } },
  MA: { electric: { commercial: 0.1962, industrial: 0.1788 }, gas: { commercial: 2.1090, industrial: 1.8149 } },
  MI: { electric: { commercial: 0.1340, industrial: 0.0816 }, gas: { commercial: 0.9383, industrial: 0.8139 } },
  MN: { electric: { commercial: 0.1178, industrial: 0.0810 }, gas: { commercial: 1.2546, industrial: 1.1659 } },
  MS: { electric: { commercial: 0.1146, industrial: 0.0680 }, gas: { commercial: 1.3327, industrial: 0.7126 } },
  MO: { electric: { commercial: 0.0995, industrial: 0.0750 }, gas: { commercial: 1.0338, industrial: 0.9257 } },
  MT: { electric: { commercial: 0.1211, industrial: 0.0780 }, gas: { commercial: 0.7570, industrial: 0.6760 } },
  NE: { electric: { commercial: 0.0969, industrial: 0.0690 }, gas: { commercial: 0.9797, industrial: 0.7203 } },
  NV: { electric: { commercial: 0.1191, industrial: 0.1036 }, gas: { commercial: 0.4831, industrial: 0.3722 } },
  NH: { electric: { commercial: 0.2040, industrial: 0.1576 }, gas: { commercial: 1.6095, industrial: 1.2228 } },
  NJ: { electric: { commercial: 0.1400, industrial: 0.1168 }, gas: { commercial: 1.5448, industrial: 1.3153 } },
  NM: { electric: { commercial: 0.1068, industrial: 0.0575 }, gas: { commercial: 0.6933, industrial: 0.9981 } },
  NY: { electric: { commercial: 0.1801, industrial: 0.0687 }, gas: { commercial: 1.2652, industrial: 1.4185 } },
  NC: { electric: { commercial: 0.0990, industrial: 0.0720 }, gas: { commercial: 1.4947, industrial: 0.8361 } },
  ND: { electric: { commercial: 0.0940, industrial: 0.0820 }, gas: { commercial: 0.6750, industrial: 0.7136 } },
  OH: { electric: { commercial: 0.1075, industrial: 0.0703 }, gas: { commercial: 0.8419, industrial: 1.1157 } },
  OK: { electric: { commercial: 0.0930, industrial: 0.0626 }, gas: { commercial: 1.0733, industrial: 0.8534 } },
  OR: { electric: { commercial: 0.0992, industrial: 0.0752 }, gas: { commercial: 1.2604, industrial: 0.4658 } },
  PA: { electric: { commercial: 0.1126, industrial: 0.0775 }, gas: { commercial: 1.3693, industrial: 1.0675 } },
  RI: { electric: { commercial: 0.1768, industrial: 0.1898 }, gas: { commercial: 1.1495, industrial: 0.9904 } },
  SC: { electric: { commercial: 0.1130, industrial: 0.0680 }, gas: { commercial: 1.4542, industrial: 0.8920 } },
  SD: { electric: { commercial: 0.1020, industrial: 0.0750 }, gas: { commercial: 0.8689, industrial: 0.8293 } },
  TN: { electric: { commercial: 0.1150, industrial: 0.0800 }, gas: { commercial: 1.2960, industrial: 0.8235 } },
  TX: { electric: { commercial: 0.0882, industrial: 0.0660 }, gas: { commercial: 1.2266, industrial: 0.6095 } },
  UT: { electric: { commercial: 0.0851, industrial: 0.0699 }, gas: { commercial: 0.9190, industrial: 0.6905 } },
  VT: { electric: { commercial: 0.1800, industrial: 0.1127 }, gas: { commercial: 0.7907, industrial: 0.7165 } },
  VA: { electric: { commercial: 0.0980, industrial: 0.0750 }, gas: { commercial: 1.1803, industrial: 0.8862 } },
  WA: { electric: { commercial: 0.0992, industrial: 0.0635 }, gas: { commercial: 1.3192, industrial: 1.3722 } },
  WV: { electric: { commercial: 0.0950, industrial: 0.0720 }, gas: { commercial: 1.2604, industrial: 0.8438 } },
  WI: { electric: { commercial: 0.1276, industrial: 0.0868 }, gas: { commercial: 0.6847, industrial: 1.0791 } },
  WY: { electric: { commercial: 0.0894, industrial: 0.0706 }, gas: { commercial: 0.7927, industrial: 0.3780 } },
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

// ---- Contract price units -----------------------------------------------
// The per-unit denominator a supply contract's PRICE is quoted against —
// $/kWh vs $/MWh, $/therm vs $/Dth. Separate from the consumption units
// above: a file can hold consumption in Dth and a price in $/MMBtu, and the
// two are read independently.
//
// Nothing converts a contract price. The page carries it exactly as the file
// wrote it and every downstream label calls it $/kWh or $/therm. These
// helpers exist so that assumption can be CHECKED rather than left silent:
// when a file says its gas price is per Dth, resolveContractPriceUom
// surfaces that and the page flags the price as being read in the wrong
// unit (a $4.50/Dth contract read as $4.50/therm is ten times high).

// The unit each commodity's price is assumed to be in when nothing says
// otherwise — and the only unit the figures downstream are correct for.
export const CANONICAL_PRICE_UOM = { electric: 'kWh', gas: 'therm' };

export function normalizeElectricPriceUom(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/\bmwh\b|megawatt/.test(s)) return 'MWh';
  if (/\bkwh\b|kilowatt/.test(s)) return 'kWh';
  return '';
}

export function normalizeGasPriceUom(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  // MMBtu before the Dth / Btu tests: "$/MMBtu" contains neither "dth" nor a
  // standalone "btu", but a looser order would still be a trap worth
  // avoiding if these patterns are ever widened.
  if (/\bmmbtu\b/.test(s)) return 'MMBtu';
  if (/\b(dth|dekatherm|decatherm)\b/.test(s)) return 'Dth';
  if (/\bmcf\b/.test(s)) return 'Mcf';
  if (/\bccf\b/.test(s)) return 'Ccf';
  if (/\bmwh\b|megawatt/.test(s)) return 'MWh';
  if (/\btherms?\b/.test(s)) return 'therm';
  return '';
}

// What unit a contract price is quoted in, and how we know.
//
//   cellValue — the row's "… Contract Price UoM" cell, when the file
//               carries that column. Most explicit, so it wins.
//   header    — the price column's own header ("Electric Contract Price
//               ($/MWh)"). Weaker, but it's what most real files carry.
//
// Returns { unit, source, canonical }. `source: 'default'` means nothing
// said, so the assumed unit stands and there is nothing to warn about — an
// unrecognized unit string is NOT treated as a mismatch, because "we can't
// read this" and "this is in the wrong unit" are different claims and only
// the second is worth putting in front of someone.
export function resolveContractPriceUom(commodity, { cellValue, header } = {}) {
  const canonicalUnit = CANONICAL_PRICE_UOM[commodity] || '';
  const normalize = commodity === 'electric' ? normalizeElectricPriceUom : normalizeGasPriceUom;
  const fromCell = normalize(cellValue);
  if (fromCell) return { unit: fromCell, source: 'column', canonical: fromCell === canonicalUnit };
  // Only the price-per-unit part of a header counts. "Gas Contract Price"
  // beside a "Gas Consumption (Dth)" column must not read as $/Dth, so the
  // unit has to be attached to a price: "$/Dth", "per Dth", "(Dth)".
  //
  // Each marker is followed by the next few words rather than just one, and
  // every marker is tried: the word straight after one is often a false
  // start. "($ per Dth)" opens on a bracket followed by a currency and then
  // "per", and stopping at either would miss the unit entirely. Only a word
  // that reads as a real unit ends the search, so the extra reach costs
  // nothing on a header that names no unit at all.
  const h = String(header || '');
  let fromHeader = '';
  for (const m of h.matchAll(/\$\s*\/|\bper\b|\(/g)) {
    const after = h.slice(m.index + m[0].length).match(/[A-Za-z]+/g) || [];
    for (const word of after.slice(0, 3)) {
      const hit = normalize(word);
      if (hit) { fromHeader = hit; break; }
    }
    if (fromHeader) break;
  }
  if (fromHeader) return { unit: fromHeader, source: 'header', canonical: fromHeader === canonicalUnit };
  return { unit: canonicalUnit, source: 'default', canonical: true };
}

export function priceUomLabel(commodity, unit) {
  return '$/' + (unit || CANONICAL_PRICE_UOM[commodity] || '');
}

// Roll the per-site resolutions up into the one line the page puts in front
// of someone: how many contract prices are quoted in a unit nothing converts,
// and which units those are.
//
// `entries` is one { electric, gas } pair per site, each side the object
// resolveContractPriceUom returned, or null where that site has no price.
// Returns null when there is nothing to say — a portfolio whose prices are
// all in the assumed unit, or that carries no prices at all, must not raise
// a warning, and callers render on the null.
export function summarizePriceUomFlags(entries) {
  const byCommodity = { electric: new Map(), gas: new Map() };
  let total = 0;
  for (const e of (entries || [])) {
    for (const commodity of ['electric', 'gas']) {
      const uom = e?.[commodity];
      if (!uom || uom.canonical) continue;
      const m = byCommodity[commodity];
      m.set(uom.unit, (m.get(uom.unit) || 0) + 1);
      total += 1;
    }
  }
  if (total === 0) return null;

  const describe = (commodity) => [...byCommodity[commodity].entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([unit, n]) => `${n} ${priceUomLabel(commodity, unit)}`)
    .join(', ');
  const parts = [];
  for (const commodity of ['electric', 'gas']) {
    if (!byCommodity[commodity].size) continue;
    const label = commodity === 'electric' ? 'Electric' : 'Gas';
    parts.push(`${label}: ${describe(commodity)} (read as ${priceUomLabel(commodity)})`);
  }
  return { total, detail: parts.join(' · ') };
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

export function stateRate(state, commodity, segment = 'commercial') {
  if (!state) return null;
  const row = STATE_RATES[state];
  if (!row) return null;
  const byCommodity = row[commodity];
  if (byCommodity == null) return null;
  // Older single-value shape ({ electric: 0.12 }) — keep working in
  // case any caller still hits a flat number.
  if (typeof byCommodity === 'number') return byCommodity;
  const seg = segment === 'industrial' ? 'industrial' : 'commercial';
  // Industrial falls back to commercial when no industrial figure
  // exists (e.g. DC gas), so an industrial site never loses its rate.
  return byCommodity[seg] ?? byCommodity.commercial ?? null;
}

// Customer-segment classification. A site is "industrial" when its
// (canonical) property type is one of the Industrial categories;
// everything else is "commercial". Returns null when there's no
// property type to classify — callers default that to commercial.
export function propertyTypeSegment(canonicalPropertyType) {
  if (!canonicalPropertyType) return null;
  return /industrial/i.test(canonicalPropertyType) ? 'industrial' : 'commercial';
}

// Parse a free-text segment value coming from an uploaded column into
// the canonical 'commercial' / 'industrial' tokens. Tolerant of common
// spellings and abbreviations; returns null when nothing usable so the
// property-type-derived classification can take over.
export function normalizeSegment(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (/\bind/.test(s) || s === 'i') return 'industrial';
  if (/\bcomm/.test(s) || s === 'c') return 'commercial';
  return null;
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
