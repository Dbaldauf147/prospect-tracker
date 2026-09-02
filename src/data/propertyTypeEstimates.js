// Per-property-type reference values used to estimate consumption and
// expected utility-account counts for the Indicative Savings export.
// Two independent tables:
//
//   1. CONSUMPTION_ESTIMATES — representative annual electric and gas
//      usage for a typical site of each property type. Numbers are
//      keyed off a reference Size_ft2, so the export scales them by
//      the site's actual square footage when that column is provided.
//
//   2. ACCOUNT_ESTIMATES — expected count of utility accounts per
//      commodity (Water / Steam / Gas / Electric / Waste) for that
//      property type. Each entry carries a `count` (numeric, used for
//      totals) and a `label` (display value — handles 'N/A',
//      'Multiple', '0 – 1', etc. that don't reduce to a single number).
//
// Numbers come straight from the user's reference tables — see
// SitesView for how they feed the export's Property Type Estimates
// tab.

export const CONSUMPTION_ESTIMATES = {
  'University / College Campus':         { category: 'Heavy',  sizeFt2: 1_000_000, electricKwh: 20_000_000, gasDth: 125_005, gasKwh: 36_635_404, totalKwh: 56_635_404 },
  'Industrial (Heavy Manufacturing)':    { category: 'Heavy',  sizeFt2:   250_000, electricKwh: 25_000_000, gasDth:  37_502, gasKwh: 10_990_621, totalKwh: 35_990_621 },
  'Data Center':                         { category: 'Heavy',  sizeFt2:   100_000, electricKwh: 30_000_000, gasDth:     500, gasKwh:    146_542, totalKwh: 30_146_542 },
  'Hospital / Healthcare':               { category: 'Heavy',  sizeFt2:   250_000, electricKwh: 10_000_000, gasDth:  62_503, gasKwh: 18_317_702, totalKwh: 28_317_702 },
  'Office - High-Rise':                  { category: 'Heavy',  sizeFt2:   500_000, electricKwh: 14_000_000, gasDth:  25_001, gasKwh:  7_327_080, totalKwh: 21_327_081 },
  'Shopping Mall / Retail Center':       { category: 'Heavy',  sizeFt2:   400_000, electricKwh: 10_000_000, gasDth:  14_001, gasKwh:  4_103_165, totalKwh: 14_103_165 },
  'Multifamily High-Rise':               { category: 'Medium', sizeFt2:   300_000, electricKwh:  3_600_000, gasDth:  21_001, gasKwh:  6_154_748, totalKwh:  9_754_748 },
  'Hotel / Lodging':                     { category: 'Medium', sizeFt2:   120_000, electricKwh:  3_360_000, gasDth:  19_201, gasKwh:  5_627_198, totalKwh:  8_987_198 },
  'Industrial (Light Manufacturing)':    { category: 'Medium', sizeFt2:   150_000, electricKwh:  4_500_000, gasDth:  11_250, gasKwh:  3_297_186, totalKwh:  7_797_186 },
  'Industrial - Other':                  { category: 'Medium', sizeFt2:   150_000, electricKwh:  3_750_000, gasDth:  12_000, gasKwh:  3_516_999, totalKwh:  7_266_999 },
  'Mixed Use':                           { category: 'Medium', sizeFt2:   200_000, electricKwh:  3_600_000, gasDth:  10_000, gasKwh:  2_930_832, totalKwh:  6_530_832 },
  'Laboratory / R&D':                    { category: 'Medium', sizeFt2:    80_000, electricKwh:  3_600_000, gasDth:   9_200, gasKwh:  2_696_366, totalKwh:  6_296_366 },
  'Office - Mid-Rise':                   { category: 'Medium', sizeFt2:   200_000, electricKwh:  4_000_000, gasDth:   7_000, gasKwh:  2_051_582, totalKwh:  6_051_583 },
  'Multifamily Mid-Rise':                { category: 'Medium', sizeFt2:   150_000, electricKwh:  1_500_000, gasDth:   9_000, gasKwh:  2_637_749, totalKwh:  4_137_749 },
  'Industrial Flex / R&D':               { category: 'Medium', sizeFt2:   100_000, electricKwh:  2_000_000, gasDth:   6_000, gasKwh:  1_758_499, totalKwh:  3_758_499 },
  'Medical Office':                      { category: 'Medium', sizeFt2:    80_000, electricKwh:  2_400_000, gasDth:   3_600, gasKwh:  1_055_100, totalKwh:  3_455_100 },
  'Refrigerated Warehouse':              { category: 'Medium', sizeFt2:    60_000, electricKwh:  2_400_000, gasDth:   1_800, gasKwh:    527_550, totalKwh:  2_927_550 },
  'School (K-12)':                       { category: 'Low',    sizeFt2:   100_000, electricKwh:  1_000_000, gasDth:   5_500, gasKwh:  1_611_958, totalKwh:  2_611_958 },
  'Senior Housing':                      { category: 'Low',    sizeFt2:    80_000, electricKwh:    960_000, gasDth:   5_600, gasKwh:  1_641_266, totalKwh:  2_601_266 },
  'Retail - Neighborhood Retail':        { category: 'Low',    sizeFt2:    80_000, electricKwh:  1_760_000, gasDth:   2_800, gasKwh:    820_633, totalKwh:  2_580_633 },
  'BTR Residential':                     { category: 'Low',    sizeFt2:   100_000, electricKwh:    900_000, gasDth:   5_000, gasKwh:  1_465_416, totalKwh:  2_365_416 },
  'Retail - High Street':                { category: 'Low',    sizeFt2:    50_000, electricKwh:  1_400_000, gasDth:   2_000, gasKwh:    586_166, totalKwh:  1_986_166 },
  'Office - Small (Low-Rise)':           { category: 'Low',    sizeFt2:    80_000, electricKwh:  1_200_000, gasDth:   2_000, gasKwh:    586_166, totalKwh:  1_786_166 },
  'Retail - Other':                      { category: 'Low',    sizeFt2:    60_000, electricKwh:  1_200_000, gasDth:   1_800, gasKwh:    527_550, totalKwh:  1_727_550 },
  'Non-Refrigerated Warehouse':          { category: 'Low',    sizeFt2:   120_000, electricKwh:    960_000, gasDth:   2_400, gasKwh:    703_400, totalKwh:  1_663_400 },
  'Multifamily Low-Rise':                { category: 'Low',    sizeFt2:    60_000, electricKwh:    420_000, gasDth:   2_700, gasKwh:    791_325, totalKwh:  1_211_325 },
  'Restaurant (Full-Service)':           { category: 'Low',    sizeFt2:     5_000, electricKwh:    500_000, gasDth:   1_375, gasKwh:    402_989, totalKwh:    902_989 },
  'Self-Storage (Climate Controlled)':   { category: 'Low',    sizeFt2:    60_000, electricKwh:    420_000, gasDth:   1_500, gasKwh:    439_625, totalKwh:    859_625 },
  'Office Occupier':                     { category: 'Low',    sizeFt2:    50_000, electricKwh:    600_000, gasDth:     751, gasKwh:    220_000, totalKwh:    820_000 },
  'Retail - Outparcel':                  { category: 'Low',    sizeFt2:    10_000, electricKwh:    350_000, gasDth:     500, gasKwh:    146_542, totalKwh:    496_542 },
  'Restaurant (Quick-Service)':          { category: 'Low',    sizeFt2:     3_000, electricKwh:    225_000, gasDth:     600, gasKwh:    175_850, totalKwh:    400_850 },
  'Self-Storage (Non-Climate Controlled)': { category: 'Low',  sizeFt2:    60_000, electricKwh:    180_000, gasDth:     300, gasKwh:     87_925, totalKwh:    267_925 },
  'Land':                                { category: 'none' },
  'Debt':                                { category: 'none' },
};

// Account-count expectations. `count` is the numeric estimate used for
// roll-up totals; `label` is what the export displays in the per-site
// cell. For ranges ('0 – 1') and 'Multiple' we use the midpoint /
// typical-portfolio guess rather than leaving the totals at zero.
// 'N/A' / no-applicable cells are `{ count: 0, label: 'N/A' }`.
//
// "Multiple" is treated as 3 for totals — a coarse stand-in. The label
// preserves the original wording so the user sees a portfolio
// distinction between "1" and "Multiple" cells when scanning the sheet.
const MULTI = (label) => ({ count: 3, label });
const NA = (label = 'N/A') => ({ count: 0, label });
const NUM = (n, label) => ({ count: n, label: label ?? String(n) });
const RANGE = (label) => ({ count: 0.5, label }); // 0 – 1 midpoint

export const ACCOUNT_ESTIMATES = {
  'University / College Campus':         { water: NUM(8),    steam: NA(),     gas: MULTI('Multiple'), electric: MULTI('Multiple'), waste: NUM(1) },
  'Industrial (Heavy Manufacturing)':    { water: NUM(1),    steam: NA(),     gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Data Center':                         { water: NUM(1),    steam: NUM(0),   gas: NA(),              electric: NUM(2),            waste: NUM(1) },
  'Hospital / Healthcare':               { water: NUM(1.5),  steam: NA(),     gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Office - High-Rise':                  { water: NUM(1),    steam: NA(),     gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Shopping Mall / Retail Center':       { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: MULTI('Multiple'), waste: NUM(1) },
  'Multifamily High-Rise':               { water: NUM(1),    steam: NA(),     gas: NUM(1),            electric: MULTI('Multiple'), waste: NUM(1) },
  'Hotel / Lodging':                     { water: NUM(1.5),  steam: NA(),     gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Industrial (Light Manufacturing)':    { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Industrial - Other':                  { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Mixed Use':                           { water: NUM(2),    steam: NA(),     gas: MULTI('Multiple'), electric: MULTI('Multiple'), waste: MULTI('Multiple') },
  'Laboratory / R&D':                    { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Office - Mid-Rise':                   { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1, '1 or Multiple'), waste: NUM(1) },
  'Multifamily Mid-Rise':                { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: MULTI('Multiple'), waste: NUM(1) },
  'Industrial Flex / R&D':               { water: NUM(1),    steam: NUM(0),   gas: MULTI('Multiple'), electric: MULTI('Multiple'), waste: NUM(1) },
  'Medical Office':                      { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1, '1 or Multiple'), waste: NUM(1) },
  'Refrigerated Warehouse':              { water: NUM(1),    steam: NUM(0),   gas: RANGE('0 – 1'),    electric: NUM(1),            waste: NUM(1) },
  'School (K-12)':                       { water: NUM(2),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Senior Housing':                      { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Retail - Neighborhood Retail':        { water: NUM(1),    steam: NUM(0),   gas: RANGE('0 – Multiple'), electric: MULTI('Multiple'), waste: NUM(1) },
  'BTR Residential':                     { water: NUM(1),    steam: NUM(0),   gas: MULTI('Multiple'), electric: MULTI('Multiple'), waste: MULTI('Multiple') },
  'Retail - High Street':                { water: NUM(1),    steam: NUM(0),   gas: RANGE('0 – Multiple'), electric: MULTI('Multiple'), waste: NUM(1) },
  'Office - Small (Low-Rise)':           { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1, '1 or Multiple'), waste: NUM(1) },
  'Retail - Other':                      { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Non-Refrigerated Warehouse':          { water: NUM(1),    steam: NUM(0),   gas: RANGE('0 – 1'),    electric: NUM(1),            waste: NUM(1) },
  'Multifamily Low-Rise':                { water: NUM(1),    steam: NUM(1),   gas: MULTI('Multiple'), electric: MULTI('Multiple'), waste: NUM(1) },
  'Restaurant (Full-Service)':           { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Self-Storage (Climate Controlled)':   { water: NUM(1),    steam: NUM(0),   gas: RANGE('0 – 1'),    electric: NUM(1),            waste: NUM(1) },
  'Office Occupier':                     { water: NUM(0),    steam: NUM(0),   gas: NA(),              electric: NA(),              waste: NA() },
  'Retail - Outparcel':                  { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Restaurant (Quick-Service)':          { water: NUM(1),    steam: NUM(0),   gas: NUM(1),            electric: NUM(1),            waste: NUM(1) },
  'Self-Storage (Non-Climate Controlled)': { water: NUM(1),  steam: NUM(0),   gas: NA(),              electric: NUM(1),            waste: NUM(1) },
  'Land':                                { water: NUM(0),    steam: NUM(0),   gas: NUM(0),            electric: NUM(0),            waste: NUM(0) },
  'Debt':                                { water: NUM(0),    steam: NUM(0),   gas: NUM(0),            electric: NUM(0),            waste: NUM(0) },
};

// Sorted list of canonical labels — handy for the property-type
// dropdown on the template / mapping UI later.
export const PROPERTY_TYPE_OPTIONS = Object.keys(CONSUMPTION_ESTIMATES);

// Sentinel target for the property-type mapping: rather than pointing a
// source value at one of the canonical types, mark it as a type with no
// usage worth modelling. Parking lots, ATMs, cell towers and the like have
// no representative consumption, so estimating one from their square
// footage would invent spend that isn't there.
//
// It suppresses the estimate and nothing else. Sites carrying it stay in the
// site count, the compliance screening and every export — they're part of
// the portfolio whether or not this page can model their usage, and dropping
// them meant a building in the file going missing from the Master Analysis.
// Consumption the user's own file supplies is still used; only the modelled
// fallback is withheld, because the estimate is keyed off a canonical
// property type and this resolves to none.
//
// Stored as a mapping value, so it round-trips with the rest of the mapping
// and can be undone from the same dropdown.
export const PROPERTY_TYPE_EXCLUDED = '__excluded__';
export const PROPERTY_TYPE_EXCLUDED_LABEL = "N/A: don't estimate usage";

// Common alternate spellings the user's sheets carry. Normalized
// against a punctuation-light, case-folded key so "Office High Rise",
// "OFFICE  HIGHRISE", "office - high rise" all collapse to one entry.
const NAME_ALIASES = {
  'university':                     'University / College Campus',
  'college':                        'University / College Campus',
  'campus':                         'University / College Campus',
  'higher education':               'University / College Campus',
  'industrial':                     'Industrial - Other',
  'industrial heavy':               'Industrial (Heavy Manufacturing)',
  'heavy industrial':               'Industrial (Heavy Manufacturing)',
  'heavy manufacturing':            'Industrial (Heavy Manufacturing)',
  'industrial light':               'Industrial (Light Manufacturing)',
  'light industrial':               'Industrial (Light Manufacturing)',
  'light manufacturing':            'Industrial (Light Manufacturing)',
  'industrial flex':                'Industrial Flex / R&D',
  'flex r d':                       'Industrial Flex / R&D',
  'flex':                           'Industrial Flex / R&D',
  'data center':                    'Data Center',
  'datacenter':                     'Data Center',
  'hospital':                       'Hospital / Healthcare',
  'healthcare':                     'Hospital / Healthcare',
  'health care':                    'Hospital / Healthcare',
  'medical':                        'Medical Office',
  'medical office':                 'Medical Office',
  'lab':                            'Laboratory / R&D',
  'labs':                           'Laboratory / R&D',
  'laboratory':                     'Laboratory / R&D',
  'r d':                            'Laboratory / R&D',
  'office high rise':               'Office - High-Rise',
  'high rise office':               'Office - High-Rise',
  'office mid rise':                'Office - Mid-Rise',
  'mid rise office':                'Office - Mid-Rise',
  'office low rise':                'Office - Small (Low-Rise)',
  'office small':                   'Office - Small (Low-Rise)',
  'small office':                   'Office - Small (Low-Rise)',
  'low rise office':                'Office - Small (Low-Rise)',
  'office':                         'Office - Mid-Rise',
  'office occupier':                'Office Occupier',
  'multifamily':                    'Multifamily Mid-Rise',
  'apartment':                      'Multifamily Mid-Rise',
  'apartments':                     'Multifamily Mid-Rise',
  'multifamily high rise':          'Multifamily High-Rise',
  'multifamily mid rise':           'Multifamily Mid-Rise',
  'multifamily low rise':           'Multifamily Low-Rise',
  'garden apartments':              'Multifamily Low-Rise',
  'btr':                            'BTR Residential',
  'build to rent':                  'BTR Residential',
  'btr residential':                'BTR Residential',
  'single family rental':           'BTR Residential',
  'sfr':                            'BTR Residential',
  'hotel':                          'Hotel / Lodging',
  'lodging':                        'Hotel / Lodging',
  'shopping mall':                  'Shopping Mall / Retail Center',
  'mall':                           'Shopping Mall / Retail Center',
  'retail center':                  'Shopping Mall / Retail Center',
  'retail neighborhood':            'Retail - Neighborhood Retail',
  'neighborhood retail':            'Retail - Neighborhood Retail',
  'strip center':                   'Retail - Neighborhood Retail',
  'retail strip':                   'Retail - Neighborhood Retail',
  'retail high street':             'Retail - High Street',
  'high street':                    'Retail - High Street',
  'retail outparcel':               'Retail - Outparcel',
  'outparcel':                      'Retail - Outparcel',
  'retail other':                   'Retail - Other',
  'big box':                        'Retail - Other',
  'retail':                         'Retail - Other',
  'mixed use':                      'Mixed Use',
  'school':                         'School (K-12)',
  'k 12':                           'School (K-12)',
  'school k 12':                    'School (K-12)',
  'senior housing':                 'Senior Housing',
  'assisted living':                'Senior Housing',
  'warehouse':                      'Non-Refrigerated Warehouse',
  'warehouse non refrigerated':     'Non-Refrigerated Warehouse',
  'non refrigerated warehouse':     'Non-Refrigerated Warehouse',
  'refrigerated warehouse':         'Refrigerated Warehouse',
  'cold storage':                   'Refrigerated Warehouse',
  'restaurant':                     'Restaurant (Full-Service)',
  'restaurant full service':        'Restaurant (Full-Service)',
  'full service restaurant':        'Restaurant (Full-Service)',
  'restaurant quick service':       'Restaurant (Quick-Service)',
  'quick service restaurant':       'Restaurant (Quick-Service)',
  'fast food':                      'Restaurant (Quick-Service)',
  'qsr':                            'Restaurant (Quick-Service)',
  'self storage':                   'Self-Storage (Climate Controlled)',
  'self storage climate':           'Self-Storage (Climate Controlled)',
  'self storage climate controlled': 'Self-Storage (Climate Controlled)',
  'self storage non climate':       'Self-Storage (Non-Climate Controlled)',
  'self storage non climate controlled': 'Self-Storage (Non-Climate Controlled)',
  'storage':                        'Self-Storage (Climate Controlled)',
  'land':                           'Land',
  'debt':                           'Debt',
};

function canonicalKey(raw) {
  return String(raw).toLowerCase().replace(/[.,()/&-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Returns the canonical property-type label, or null when no match
// resolves. Direct hits are tried first (case-insensitive), then the
// alias table, then a fuzzy "name contains key" scan so longer source
// strings ("Office – High-Rise Building") still hit "Office -
// High-Rise".
export function normalizePropertyType(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (CONSUMPTION_ESTIMATES[trimmed]) return trimmed;
  const key = canonicalKey(trimmed);
  if (!key) return null;
  const aliased = NAME_ALIASES[key];
  if (aliased && CONSUMPTION_ESTIMATES[aliased]) return aliased;
  for (const name of Object.keys(CONSUMPTION_ESTIMATES)) {
    if (canonicalKey(name) === key) return name;
  }
  // Longest-canonical-substring fallback so "Industrial Heavy
  // Manufacturing Plant" still resolves to the Industrial (Heavy
  // Manufacturing) row.
  let bestMatch = null;
  let bestLen = 0;
  for (const name of Object.keys(CONSUMPTION_ESTIMATES)) {
    const nameKey = canonicalKey(name);
    if (nameKey.length > 4 && key.includes(nameKey) && nameKey.length > bestLen) {
      bestMatch = name;
      bestLen = nameKey.length;
    }
  }
  return bestMatch;
}

export function propertyTypeConsumption(rawType) {
  const name = normalizePropertyType(rawType);
  if (!name) return null;
  return CONSUMPTION_ESTIMATES[name];
}

export function propertyTypeAccounts(rawType) {
  const name = normalizePropertyType(rawType);
  if (!name) return null;
  return ACCOUNT_ESTIMATES[name];
}

// Every commodity's account estimate for a property type, added up. A
// data deal is priced per utility account per month, so this is the unit
// a site list has to roll up into: one site of a given type carries this
// many bills. Labels that aren't a single number ('Multiple', '0 – 1',
// 'N/A') contribute their `count` — the same 3 / 0.5 / 0 the export's
// Total row uses. Returns null for an unrecognized type so callers can
// tell "no estimate" from a genuine zero.
export function propertyTypeAccountTotal(rawType) {
  const acc = propertyTypeAccounts(rawType);
  if (!acc) return null;
  return ['electric', 'gas', 'water', 'waste', 'steam']
    .reduce((sum, k) => sum + (Number(acc[k]?.count) || 0), 0);
}

// Estimate a site's annual electric / gas usage from its property
// type + optional Size_ft2. When a size is provided we scale by
// (actualSize / referenceSize) — labs at 40,000 sf get half the
// 80,000 sf reference numbers. Falls back to the reference values
// when size is missing.
//
// Returns null when the property type isn't recognized or has no
// consumption profile (Land / Debt). Otherwise returns the same shape
// CONSUMPTION_ESTIMATES carries, with the numbers scaled.
export function estimateConsumption(rawType, sizeFt2) {
  const base = propertyTypeConsumption(rawType);
  if (!base || base.electricKwh == null) return null;
  const actual = Number(sizeFt2);
  const ref = Number(base.sizeFt2);
  const scale = Number.isFinite(actual) && actual > 0 && Number.isFinite(ref) && ref > 0
    ? actual / ref
    : 1;
  return {
    category: base.category,
    sizeFt2: Number.isFinite(actual) && actual > 0 ? actual : ref,
    referenceSizeFt2: ref,
    scale,
    electricKwh: Math.round(base.electricKwh * scale),
    gasDth: Math.round(base.gasDth * scale),
    gasKwh: Math.round(base.gasKwh * scale),
    totalKwh: Math.round(base.totalKwh * scale),
  };
}

// 1 dekatherm = 1,000,000 BTU = 293.07107 kWh. The gas kWh-equivalent
// column in CONSUMPTION_ESTIMATES is built on this factor (125,005 Dth →
// 36,635,404 kWh), so anything converting a site's own Dth to kWh has to
// use the same one or the two won't line up.
export const KWH_PER_DTH = 293.07107;

// Per-square-foot energy intensity of a property type's reference
// profile — the reference consumption divided by the reference size.
//
// Scaling is linear (estimateConsumption multiplies every number by
// actualSize / referenceSize), so intensity is size-invariant: this is
// both the reference profile's intensity AND the intensity of the
// estimate for any site of that type, whatever its square footage. That
// is what makes it usable as a benchmark — a site's measured intensity
// can be held against it directly.
//
// Returns null for a type with no consumption profile (Land / Debt,
// unrecognized names) so callers can tell "no benchmark" from a zero.
export function propertyTypeIntensity(rawType) {
  const base = propertyTypeConsumption(rawType);
  if (!base || base.electricKwh == null) return null;
  const ref = Number(base.sizeFt2);
  if (!Number.isFinite(ref) || ref <= 0) return null;
  return {
    category: base.category,
    referenceSizeFt2: ref,
    electricKwhPerFt2: base.electricKwh / ref,
    gasDthPerFt2: base.gasDth / ref,
    gasKwhPerFt2: base.gasKwh / ref,
    totalKwhPerFt2: base.totalKwh / ref,
  };
}

// How far a measured figure sits from the estimate it is held against,
// as a signed fraction: +0.30 is 30% above the estimate, -0.15 is 15%
// below. Used for both the per-ft² intensities above and the indicative
// rates the Site Detail tab compares a site's actual $/kWh against.
// Null when either side is missing or the estimate is zero — "no
// answer", which the export renders as an empty cell rather than as a
// 0% that would read as "spot on the estimate".
export function varianceVsEstimate(actual, estimate) {
  if (typeof actual !== 'number' || !Number.isFinite(actual)) return null;
  if (typeof estimate !== 'number' || !Number.isFinite(estimate) || estimate <= 0) return null;
  // Rounded to 0.01% — a hundred times finer than the whole-percent the
  // export displays, so nothing real is lost, and it stops noise below
  // that resolution from rendering as "-0%". The noise is not float
  // error: the reference table's kWh-equivalent gas column is rounded to
  // whole kWh, so a site modelled straight off the table lands ~0.004%
  // away from a total recomputed at 293.07107 kWh/Dth. "-0%" on a row
  // that is by construction exactly on its estimate reads as a real
  // shortfall, which is the one thing this column must not do.
  //
  // `|| 0` collapses a negative zero (which -0.00002 rounds to) onto a
  // plain 0 — a sign that survives into the cell would be the same
  // "-0%" by another route.
  return (Math.round(((actual / estimate) - 1) * 1e4) / 1e4) || 0;
}
