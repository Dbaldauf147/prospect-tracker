// ISO / RTO region reference for the Indicative Savings "ISO View" export
// tab. Maps each US state (2-letter postal code) to the wholesale
// electricity market region it predominantly sits in, plus a display
// palette for the choropleth + legend.
//
// IMPORTANT — this is a WHOLE-STATE APPROXIMATION. Real ISO/RTO footprints
// do not follow state lines: Texas is mostly ERCOT but its edges fall in
// SPP / MISO / WECC; the Dakotas, Nebraska, Montana and others straddle
// SPP and MISO; Illinois / Indiana / Michigan / Kentucky span MISO and
// PJM. Because the export's map is drawn from whole-state polygons, each
// state is assigned to the single region that covers most of it, so the
// map reproduces the *dominant* region per state rather than the exact
// seam-level boundaries. Non-ISO areas (utilities still vertically
// integrated) are grouped into the regional buckets shown on the standard
// NAM ISO map: Northwest, Southwest, and Southeast.

// Ordered so the legend reads west-to-east / ISO-then-non-ISO, matching
// the reference map. `key` is the internal id, `label` the legend text,
// `fill` the base choropleth hue (ARGB-less hex; the drawing code adds
// density shading on top).
export const ISO_REGIONS = [
  { key: 'CAISO',     label: 'CAISO',     fill: '#0F5E4E' }, // California ISO
  { key: 'ERCOT',     label: 'ERCOT',     fill: '#111111' }, // Texas (islanded grid)
  { key: 'SPP',       label: 'SPP',       fill: '#1C6E8C' }, // Southwest Power Pool
  { key: 'MISO',      label: 'MISO',      fill: '#7FC2E3' }, // Midcontinent ISO
  { key: 'PJM',       label: 'PJM',       fill: '#33A5C4' }, // PJM Interconnection
  { key: 'NYISO',     label: 'NYISO',     fill: '#8AD0C9' }, // New York ISO
  { key: 'ISONE',     label: 'ISO-NE',    fill: '#2F6DA4' }, // ISO New England
  { key: 'NORTHWEST', label: 'Northwest', fill: '#3B8C7E' }, // Non-ISO (WECC NW)
  { key: 'SOUTHWEST', label: 'Southwest', fill: '#A9C5A6' }, // Non-ISO (WECC SW)
  { key: 'SOUTHEAST', label: 'Southeast', fill: '#5B8CB3' }, // Non-ISO (SERC)
];

// Fast lookup: region key -> base fill hex.
export const ISO_FILL = Object.fromEntries(ISO_REGIONS.map(r => [r.key, r.fill]));
// Fast lookup: region key -> display label.
export const ISO_LABEL = Object.fromEntries(ISO_REGIONS.map(r => [r.key, r.label]));

// State (2-letter code, incl. DC) -> dominant ISO / RTO region.
// Alaska and Hawaii have no continental market and are intentionally
// omitted (they map to null via isoForState and are skipped on the map).
export const STATE_TO_ISO = {
  // CAISO
  CA: 'CAISO',
  // ERCOT
  TX: 'ERCOT',
  // SPP
  KS: 'SPP', NE: 'SPP', ND: 'SPP', SD: 'SPP', OK: 'SPP',
  // MISO
  AR: 'MISO', IL: 'MISO', IN: 'MISO', IA: 'MISO', LA: 'MISO',
  MI: 'MISO', MN: 'MISO', MS: 'MISO', MO: 'MISO', WI: 'MISO',
  // PJM
  DC: 'PJM', DE: 'PJM', KY: 'PJM', MD: 'PJM', NJ: 'PJM',
  OH: 'PJM', PA: 'PJM', VA: 'PJM', WV: 'PJM',
  // NYISO
  NY: 'NYISO',
  // ISO-NE
  CT: 'ISONE', ME: 'ISONE', MA: 'ISONE', NH: 'ISONE', RI: 'ISONE', VT: 'ISONE',
  // Northwest (non-ISO)
  WA: 'NORTHWEST', OR: 'NORTHWEST', ID: 'NORTHWEST', MT: 'NORTHWEST', WY: 'NORTHWEST',
  // Southwest (non-ISO)
  AZ: 'SOUTHWEST', CO: 'SOUTHWEST', NV: 'SOUTHWEST', NM: 'SOUTHWEST', UT: 'SOUTHWEST',
  // Southeast (non-ISO)
  AL: 'SOUTHEAST', FL: 'SOUTHEAST', GA: 'SOUTHEAST', NC: 'SOUTHEAST', SC: 'SOUTHEAST', TN: 'SOUTHEAST',
};

// Resolve a 2-letter state code to its ISO region key, or null if the
// state has no mapped region (AK, HI, or an unrecognized code).
export function isoForState(stateCode) {
  const s = String(stateCode || '').trim().toUpperCase();
  return STATE_TO_ISO[s] || null;
}
