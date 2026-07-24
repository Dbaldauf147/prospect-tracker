// ISO / RTO region reference for the Indicative Savings "ISO View" export
// tab. Aligned to the ISO/RTO Council (IRC) reference map: only the actual
// ISO / RTO market footprints are shown. Anything outside those footprints
// — the vertically-integrated / non-ISO West and Southeast, plus AK / HI —
// resolves to null and is drawn grey (no ISO). Coverage spans the seven US
// ISOs/RTOs plus the three Canadian markets on the IRC map: Alberta (AESO),
// Ontario (IESO), and New Brunswick (NB System Operator).
//
// TWO LEVELS OF RESOLUTION:
//
//  • MAP FOOTPRINT — the choropleth is drawn from whole admin-1 polygons
//    (US states + DC, Canadian provinces), so each is coloured by the ONE
//    ISO that covers most of it (STATE_TO_ISO / PROVINCE_TO_ISO). Real ISO
//    seams cut through states; this is a deliberate whole-state
//    approximation, indicative not authoritative.
//
//  • PER-SITE — a site is assigned to its ISO the finer way: by its electric
//    UTILITY first (utilities belong to one market), then by ZIP, then by
//    state. This lands split-state sites in the right market — e.g. a
//    Chicago site (ComEd / ZIP 606) → PJM even though Illinois' footprint
//    polygon is MISO. The summary table and the per-state map colour both
//    run off this per-site resolution.
//
// The utility patterns and ZIP-prefix overrides below cover the major
// split-state cases; they are best-effort and fall through to the dominant
// state when nothing more specific matches.

import { zipToState } from '../utils/utilityRates';

// Ordered west-to-east, US markets then Canadian, matching the legend /
// reference-map reading order. `fill` hues are validated for adjacent-pair
// separation (see the dataviz palette check); ERCOT's deep magenta keeps it
// clear of SPP red where the two markets meet at the Texas border.
export const ISO_REGIONS = [
  { key: 'CAISO', label: 'CAISO',  fill: '#7E57C2' }, // California ISO
  { key: 'ERCOT', label: 'ERCOT',  fill: '#880E4F' }, // Texas (islanded grid)
  { key: 'SPP',   label: 'SPP',    fill: '#E53935' }, // Southwest Power Pool
  { key: 'MISO',  label: 'MISO',   fill: '#2E9E4F' }, // Midcontinent ISO
  { key: 'PJM',   label: 'PJM',    fill: '#1E6FBF' }, // PJM Interconnection
  { key: 'NYISO', label: 'NYISO',  fill: '#F2A100' }, // New York ISO
  { key: 'ISONE', label: 'ISO-NE', fill: '#3F51B5' }, // ISO New England
  { key: 'AESO',  label: 'AESO',   fill: '#FB8C00' }, // Alberta ESO
  { key: 'IESO',  label: 'IESO',   fill: '#00ACC1' }, // Ontario IESO
  { key: 'NBSO',  label: 'NB SO',  fill: '#FBC02D' }, // New Brunswick SO
];

// Fast lookup: region key -> base fill hex.
export const ISO_FILL = Object.fromEntries(ISO_REGIONS.map(r => [r.key, r.fill]));
// Fast lookup: region key -> display label.
export const ISO_LABEL = Object.fromEntries(ISO_REGIONS.map(r => [r.key, r.label]));

// US state (2-letter, incl. DC) -> dominant ISO for the whole-state MAP
// FOOTPRINT. Only states the IRC map actually colours are listed; anything
// absent (the non-ISO West + Southeast, AK/HI) resolves to null = no ISO =
// grey. Split states are assigned to the market covering most of the state;
// the per-site resolver (utility / ZIP) corrects individual sites.
export const STATE_TO_ISO = {
  // CAISO
  CA: 'CAISO',
  // ERCOT
  TX: 'ERCOT',
  // SPP (Great Plains)
  KS: 'SPP', OK: 'SPP', NE: 'SPP', ND: 'SPP', SD: 'SPP',
  // MISO (Upper Midwest + Mid-South)
  MN: 'MISO', IA: 'MISO', WI: 'MISO', IL: 'MISO', IN: 'MISO',
  MI: 'MISO', MO: 'MISO', AR: 'MISO', LA: 'MISO', MS: 'MISO',
  // PJM (Mid-Atlantic + eastern Midwest)
  OH: 'PJM', PA: 'PJM', WV: 'PJM', VA: 'PJM', MD: 'PJM',
  DE: 'PJM', NJ: 'PJM', DC: 'PJM',
  // NYISO
  NY: 'NYISO',
  // ISO-NE
  CT: 'ISONE', ME: 'ISONE', MA: 'ISONE', NH: 'ISONE', RI: 'ISONE', VT: 'ISONE',
  // Deliberately NOT mapped (non-ISO / vertically integrated, drawn grey):
  //   West:  WA OR ID MT WY NV UT AZ CO NM
  //   S.E.:  AL FL GA SC NC TN  and  KY (LG&E-KU is non-RTO; the AEP-east
  //          and Big Rivers corners of KY are picked up per-site via ZIP)
  //   AK HI: no continental market.
};

// Canadian province (2-letter) -> ISO. Only the three IRC-mapped markets;
// every other province / territory resolves to null = grey. Canadian
// provinces are single-market, so there's no split to correct per-site.
export const PROVINCE_TO_ISO = {
  AB: 'AESO',
  ON: 'IESO',
  NB: 'NBSO',
};

// ZIP3 (first three ZIP digits) -> ISO overrides for the clearest split
// states, where the dominant-state footprint above is wrong for that corner
// of the state. Ranges mirror utilityRates' ZIP_PREFIX_TO_STATE. Indicative
// only — real seams follow utility service territories, not ZIP bands.
export const ZIP3_TO_ISO = (() => {
  const map = new Map();
  const add = (start, end, iso) => {
    for (let i = start; i <= end; i++) map.set(String(i).padStart(3, '0'), iso);
  };
  // Northern Illinois — ComEd (PJM). Downstate IL (Ameren) stays MISO.
  add(600, 608, 'PJM');
  // Northeast Indiana — AEP Indiana Michigan Power around Fort Wayne (PJM).
  // The rest of Indiana stays MISO.
  add(467, 469, 'PJM');
  // Kentucky is non-ISO in the middle (LG&E / KU), so KY has no state
  // footprint. Its market corners are picked up here:
  //   Eastern KY  — AEP Kentucky Power (PJM), Ashland / Pikeville / Hazard.
  add(411, 418, 'PJM');
  //   Western KY  — Big Rivers Electric (MISO), Paducah / Owensboro.
  add(420, 421, 'MISO');
  add(423, 425, 'MISO');
  // Western Missouri — Evergy Missouri West / KCP&L (SPP) around Kansas
  // City. Eastern MO (Ameren Missouri, St. Louis) stays MISO.
  add(640, 641, 'SPP');
  add(644, 648, 'SPP');
  return map;
})();

// Normalize a utility name for pattern matching: lowercase, drop most
// punctuation, collapse whitespace. "AEP Ohio, Inc." -> "aep ohio inc".
function normalizeUtilityName(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Utility name pattern -> ISO. This is the PRIMARY per-site signal for the
// split states: the electric utility (LDC) belongs to exactly one market,
// so it beats both ZIP and state. More specific patterns must precede more
// general ones (AEP Texas / SWEPCO before a bare "aep"). Utilities not
// listed fall through to the ZIP / state resolution — including non-RTO
// utilities, which correctly land on "no ISO" via a null state.
const UTILITY_ISO_PATTERNS = [
  // --- AEP operating companies span three markets, so match them first ---
  [/aep texas|\btnc\b|texas north company|texas central company/, 'ERCOT'],
  [/public service (company )?of oklahoma|\bpso\b/, 'SPP'],
  [/southwestern electric power|\bswepco\b/, 'SPP'],
  [/aep ohio|columbus southern|ohio power/, 'PJM'],
  [/appalachian power|\bapco\b/, 'PJM'],
  [/indiana michigan power|\bi and m\b|\bindiana michigan\b/, 'PJM'],
  [/kentucky power/, 'PJM'],
  [/wheeling power/, 'PJM'],
  // --- Illinois: ComEd (PJM) vs Ameren (MISO) ---
  [/commonwealth edison|\bcomed\b/, 'PJM'],
  [/ameren/, 'MISO'],
  // --- Ohio / Kentucky Duke + Dayton (PJM) vs Duke Indiana (MISO) ---
  [/duke energy indiana/, 'MISO'],
  [/duke energy (ohio|kentucky)/, 'PJM'],
  [/dayton power|\bdp and l\b|aes ohio/, 'PJM'],
  [/first ?energy|toledo edison|ohio edison|cleveland electric|penn power|jersey central|met ed|penelec|mon power|potomac edison|west penn power/, 'PJM'],
  // --- Indiana MISO utilities ---
  [/nipsco|northern indiana public service/, 'MISO'],
  [/indianapolis power|\bipl\b|aes indiana|hoosier energy|vectren|centerpoint.*indiana/, 'MISO'],
  // --- Kentucky ---
  [/big rivers/, 'MISO'],
  // --- Missouri: Evergy West / KCP&L (SPP) vs Ameren Missouri (MISO) ---
  [/kansas city power|\bkcp and l\b|evergy (missouri )?(metro|west)/, 'SPP'],
  // --- Xcel operating companies span three markets, so match only the
  //     unambiguous names; bare "Xcel" falls through to ZIP / state, which
  //     correctly lands Xcel Colorado (PSCo, non-ISO) on no market. ---
  [/southwestern public service|\bsps\b|xcel.*(texas|new mexico)/, 'SPP'],
  [/northern states power/, 'MISO'],
  // --- Other clear SPP members ---
  [/westar|evergy (kansas|central)|\bempire district\b|oklahoma gas and electric|\boge\b|kansas city board|\bkcbpu\b|nebraska public power|omaha public power|\boppd\b/, 'SPP'],
  // --- Michigan / Wisconsin / Iowa / Minnesota MISO ---
  [/consumers energy|\bdte\b|detroit edison/, 'MISO'],
  [/we energies|wisconsin electric|wisconsin public service|madison gas|alliant|interstate power|wisconsin power/, 'MISO'],
  [/midamerican|mid american/, 'MISO'],
  // --- PJM Mid-Atlantic majors ---
  [/\bpepco\b|potomac electric|baltimore gas|\bbge\b|delmarva|atlantic city electric|\bpseg\b|public service electric|pp and l|\bppl\b|pennsylvania power|dominion (energy )?(virginia|north carolina)|virginia electric|\bduquesne\b|rockland electric/, 'PJM'],
  // --- New York / New England ---
  [/con ?ed|consolidated edison|orange and rockland|central hudson|national grid.*(new york|niagara)|nyseg|new york state electric|rochester gas|\bo and r\b/, 'NYISO'],
  [/eversource|national grid.*(massachusetts|rhode island)|nstar|united illuminating|versant|central maine power|\bcmp\b|liberty utilities.*new hampshire|unitil|green mountain power|narragansett/, 'ISONE'],
  // --- California ---
  [/pacific gas|\bpg and e\b|southern california edison|\bsce\b|san diego gas|\bsdg and e\b/, 'CAISO'],
  // --- Texas / ERCOT ---
  [/oncor|centerpoint.*(houston|texas)|reliant|txu|texas new mexico power|\btnmp\b/, 'ERCOT'],
  // --- Canadian markets. Province already resolves these unambiguously;
  //     these entries only help when a province code is missing. Kept to
  //     unmistakable Canadian utility names — no bare "alberta" / "ontario"
  //     / "new brunswick", which collide with US places (Ontario, CA;
  //     New Brunswick, NJ). ---
  [/enmax|epcor|\bfortis ?alberta\b/, 'AESO'],
  [/hydro one|toronto hydro|\balectra\b|hydro ottawa|\bieso\b/, 'IESO'],
  [/nb power|new brunswick power/, 'NBSO'],
];

// Resolve a US 2-letter state code to its dominant footprint ISO, or null.
export function isoForState(stateCode) {
  const s = String(stateCode || '').trim().toUpperCase();
  return STATE_TO_ISO[s] || null;
}

// Resolve a Canadian 2-letter province code to its ISO, or null.
export function isoForProvince(provinceCode) {
  const s = String(provinceCode || '').trim().toUpperCase();
  return PROVINCE_TO_ISO[s] || null;
}

// Resolve a US ZIP to an ISO: a ZIP3 split-state override wins; otherwise
// fall back to the dominant ISO of the ZIP's state (via zipToState).
export function isoForZip(zip) {
  const z = String(zip || '').trim();
  if (!z) return null;
  const z3 = z.slice(0, 3).padStart(3, '0');
  if (ZIP3_TO_ISO.has(z3)) return ZIP3_TO_ISO.get(z3);
  return isoForState(zipToState(z));
}

// Resolve a utility name to an ISO via the pattern table, or null when no
// pattern matches (caller falls back to ZIP / state).
export function isoForUtility(name) {
  const n = normalizeUtilityName(name);
  if (!n) return null;
  for (const [re, iso] of UTILITY_ISO_PATTERNS) {
    if (re.test(n)) return iso;
  }
  return null;
}

// Per-site ISO resolution. US sites resolve utility -> ZIP -> state;
// Canadian sites resolve by province (single-market). Returns an ISO region
// key or null (no market / outside the IRC map).
export function resolveSiteIso({ admin, code, zip, utility } = {}) {
  if (admin === 'CA') {
    return isoForUtility(utility) || isoForProvince(code);
  }
  // Default to US resolution.
  return isoForUtility(utility) || isoForZip(zip) || isoForState(code) || null;
}
