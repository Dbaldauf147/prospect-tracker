// Geographic reference data used by the Indicative Savings export's
// Portfolio Overview map. Everything is in plain lat/lng degrees so
// the renderer can project equirectangular ((lng+180)/360 * width,
// (90-lat)/180 * height) directly.
//
// The map graphic is a public-domain blank political world map
// (Wikimedia Commons File:BlankMap-World-Equirectangular.svg)
// bundled at src/assets/world-map.png. Country polygons for
// choropleth coloring come from world-atlas's countries-110m.json
// (TopoJSON, ~108 KB) decoded inline below.

// ---------------- TopoJSON decoder ----------------
// Minimal decoder for the world-atlas TopoJSON shape — accepts a
// `topology` object and returns an array of features
// `{ id, name, rings: [[[lng,lat], ...], ...] }`. Each ring is a
// closed polygon; multipolygons contribute multiple rings under the
// same feature so the renderer can fill each one.
//
// Arcs are delta-encoded against the previous point in the arc, then
// scaled by `transform.scale` and offset by `transform.translate` to
// recover real lng/lat. Negative arc indices mean the arc is reversed
// (twoComplementsNot via `~i`).

import countriesTopology from './countries-110m.json';

function decodeArcs(topology) {
  const { scale: [kx, ky], translate: [dx, dy] } = topology.transform;
  return topology.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dxd, dyd]) => {
      x += dxd; y += dyd;
      return [x * kx + dx, y * ky + dy];
    });
  });
}

function buildRing(ringArcIndices, decodedArcs) {
  const points = [];
  for (let i = 0; i < ringArcIndices.length; i++) {
    const arcIdx = ringArcIndices[i];
    const reverse = arcIdx < 0;
    const arc = decodedArcs[reverse ? ~arcIdx : arcIdx];
    const arcPoints = reverse ? arc.slice().reverse() : arc;
    // Each arc shares its first point with the prior arc's last
    // point — drop the duplicate when stitching them together.
    if (i > 0) points.pop();
    points.push(...arcPoints);
  }
  return points;
}

function buildRingsFromGeometry(geometry, decodedArcs) {
  if (geometry.type === 'Polygon') {
    return geometry.arcs.map(ring => buildRing(ring, decodedArcs));
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.arcs.flatMap(poly => poly.map(ring => buildRing(ring, decodedArcs)));
  }
  return [];
}

let _decodedCountries = null;
export function getCountryFeatures() {
  if (_decodedCountries) return _decodedCountries;
  const arcs = decodeArcs(countriesTopology);
  _decodedCountries = countriesTopology.objects.countries.geometries.map(g => ({
    id: g.id,
    name: g.properties?.name || '',
    rings: buildRingsFromGeometry(g, arcs),
  }));
  return _decodedCountries;
}

// TopoJSON uses slightly different country names than the
// COUNTRY_DEREGULATION reference. Mapping resolves the common
// mismatches; anything not listed here is matched directly by name
// (and if no entry in COUNTRY_DEREGULATION matches the country falls
// through to the "unknown" tier).
export const TOPO_NAME_TO_DEREG_KEY = {
  'United States of America': 'United States',
  'Czech Republic':            'Czechia',
  "Côte d'Ivoire":             'Ivory Coast',
  'Dominican Rep.':            'Dominican Republic',
  'Dem. Rep. Congo':           'Democratic Republic of the Congo',
  'Eq. Guinea':                'Equatorial Guinea',
  'Macedonia':                 'North Macedonia',
  'Bosnia and Herz.':          'Bosnia and Herzegovina',
  'Central African Rep.':      'Central African Republic',
  "Lao PDR":                   'Laos',
  'Korea':                     'South Korea',
  'Dem. Rep. Korea':           'North Korea',
  'Solomon Is.':               'Solomon Islands',
  'eSwatini':                  'Eswatini',
  'S. Sudan':                  'South Sudan',
  'W. Sahara':                 'Western Sahara',
  'N. Cyprus':                 'Cyprus',
  'Russia':                    'Russia',
  'Vietnam':                   'Vietnam',
  'Brunei':                    'Brunei',
  'Falkland Is.':              'Falkland Islands',
};

// ISO 3166-1 numeric ids for countries that don't have a clean
// single-tier classification at the country level (their dereg
// status varies materially by sub-region). We render these in the
// "Mixed" tier (blue-gray) on the map.
export const MIXED_TIER_COUNTRY_IDS = new Set([
  '840', // United States of America
  '124', // Canada
]);

// Country centers — approximate centroids in [lng, lat]. Covers the
// ~80 most likely upload destinations; lookups fall back to the
// region centroid in CONTINENT_POLYGONS when the country isn't here.
export const COUNTRY_CENTERS = {
  'United States':         [-98, 39],
  'Canada':                [-96, 56],
  'Mexico':                [-102, 23],
  'United Kingdom':        [-2, 54],
  'Ireland':               [-8, 53],
  'France':                [2, 47],
  'Germany':               [10, 51],
  'Spain':                 [-4, 40],
  'Portugal':              [-8, 40],
  'Italy':                 [12, 42],
  'Netherlands':           [5, 52],
  'Belgium':               [4, 50],
  'Luxembourg':            [6, 50],
  'Switzerland':           [8, 47],
  'Austria':               [14, 47],
  'Denmark':               [10, 56],
  'Norway':                [10, 62],
  'Sweden':                [16, 62],
  'Finland':               [26, 64],
  'Iceland':               [-19, 65],
  'Poland':                [19, 52],
  'Czechia':               [15, 50],
  'Slovakia':              [19, 49],
  'Hungary':               [19, 47],
  'Romania':               [25, 46],
  'Bulgaria':              [25, 43],
  'Greece':                [22, 39],
  'Turkey':                [35, 39],
  'Russia':                [100, 60],
  'Ukraine':               [32, 49],
  'Estonia':               [26, 59],
  'Latvia':                [25, 57],
  'Lithuania':             [24, 55],
  'Belarus':               [28, 53],
  'Croatia':               [16, 45],
  'Slovenia':              [15, 46],
  'Serbia':                [21, 44],
  'Bosnia and Herzegovina':[18, 44],
  'Albania':               [20, 41],
  'North Macedonia':       [22, 41],
  'Cyprus':                [33, 35],
  'Malta':                 [14, 36],

  'China':                 [105, 35],
  'Japan':                 [138, 36],
  'South Korea':           [128, 36],
  'Taiwan':                [121, 24],
  'Hong Kong':             [114, 22],
  'India':                 [78, 22],
  'Pakistan':              [70, 30],
  'Bangladesh':            [90, 24],
  'Sri Lanka':             [81, 8],
  'Thailand':              [101, 15],
  'Vietnam':               [108, 16],
  'Malaysia':              [102, 4],
  'Singapore':             [104, 1.3],
  'Indonesia':             [113, -2],
  'Philippines':           [122, 13],
  'Cambodia':              [105, 13],
  'Laos':                  [103, 18],
  'Myanmar':               [96, 21],
  'Mongolia':              [104, 46],
  'Kazakhstan':            [67, 48],
  'Uzbekistan':            [64, 41],
  'Iran':                  [53, 32],
  'Iraq':                  [44, 33],
  'Saudi Arabia':          [45, 24],
  'United Arab Emirates':  [54, 24],
  'Israel':                [35, 31],
  'Lebanon':               [36, 34],
  'Jordan':                [36, 31],
  'Qatar':                 [51, 25],
  'Kuwait':                [48, 29],
  'Oman':                  [56, 21],
  'Bahrain':               [51, 26],

  'Australia':             [134, -25],
  'New Zealand':           [172, -41],

  'Brazil':                [-53, -10],
  'Argentina':             [-65, -34],
  'Chile':                 [-71, -35],
  'Peru':                  [-76, -10],
  'Colombia':              [-74, 4],
  'Venezuela':             [-66, 8],
  'Ecuador':               [-78, -2],
  'Bolivia':               [-65, -17],
  'Paraguay':              [-58, -23],
  'Uruguay':               [-56, -33],

  'Egypt':                 [30, 27],
  'Morocco':               [-6, 32],
  'Algeria':               [3, 28],
  'Tunisia':               [9, 34],
  'Libya':                 [17, 27],
  'South Africa':          [25, -29],
  'Nigeria':               [8, 10],
  'Kenya':                 [37, 0],
  'Ethiopia':              [40, 9],
  'Ghana':                 [-1, 8],
  'Tanzania':              [35, -6],
  'Uganda':                [32, 1],
  'Senegal':               [-14, 14],
  'Ivory Coast':           [-5, 8],

  'Guatemala':             [-90, 15],
  'Costa Rica':            [-84, 10],
  'Panama':                [-80, 9],
  'Honduras':              [-87, 15],
  'El Salvador':           [-89, 14],
  'Nicaragua':             [-85, 13],
  'Dominican Republic':    [-71, 19],
  'Puerto Rico':           [-66, 18],
  'Cuba':                  [-79, 22],
  'Jamaica':               [-77, 18],
};

// US state centers — approximate geographic / population centroids.
// Used when a site's country resolves to the US so the dot lands in
// the right region instead of a single US blob.
export const US_STATE_CENTERS = {
  AL: [-86.8, 32.8], AK: [-152, 64], AZ: [-111.7, 34.3], AR: [-92.4, 34.9],
  CA: [-119.4, 36.8], CO: [-105.5, 39.1], CT: [-72.7, 41.6], DE: [-75.5, 39],
  FL: [-81.5, 28.6], GA: [-83.4, 32.7], HI: [-156, 20.7], ID: [-114.5, 44.4],
  IL: [-89.2, 40], IN: [-86.3, 39.9], IA: [-93.2, 42.1], KS: [-98.4, 38.5],
  KY: [-84.9, 37.5], LA: [-91.9, 31.1], ME: [-69.4, 45.4], MD: [-76.8, 39.1],
  MA: [-71.8, 42.2], MI: [-84.5, 44.3], MN: [-94.3, 46.3], MS: [-89.7, 32.7],
  MO: [-92.4, 38.5], MT: [-110, 47], NE: [-99.8, 41.5], NV: [-117, 38.5],
  NH: [-71.6, 43.7], NJ: [-74.5, 40.3], NM: [-106.2, 34.4], NY: [-75.5, 42.9],
  NC: [-79.4, 35.6], ND: [-99.8, 47.5], OH: [-82.8, 40.4], OK: [-97.5, 35.5],
  OR: [-120.6, 44], PA: [-77.2, 40.6], RI: [-71.5, 41.7], SC: [-80.9, 33.9],
  SD: [-99.4, 44.3], TN: [-86.7, 35.7], TX: [-99, 31.1], UT: [-111.9, 40.2],
  VT: [-72.6, 44], VA: [-78.2, 37.8], WA: [-121.5, 47.4], WV: [-80.6, 38.5],
  WI: [-89.6, 44.3], WY: [-107.3, 42.8], DC: [-77, 38.9],
};

// Canadian provinces + territories — approximate centroids in [lng, lat].
export const CANADA_PROVINCE_CENTERS = {
  AB: [-115, 54], BC: [-125, 54], MB: [-98, 54], NB: [-66, 46],
  NL: [-59, 52], NS: [-63, 45], NT: [-120, 64], NU: [-92, 70],
  ON: [-86, 50], PE: [-63, 46], QC: [-72, 53], SK: [-106, 54],
  YT: [-135, 64],
};

// Normalize a deregulation status string from countryDeregulation.js
// to a tier the map uses for coloring. Tiers map to fixed canvas
// colors in the renderer:
//   'dereg' (green)  — Deregulated
//   'some'  (orange) — Some deregulation
//   'reg'   (red)    — Unlikely / No opportunity / regulated
//   'unknown' (gray) — null or unrecognized
export function statusTier(status) {
  if (status == null) return 'unknown';
  const s = String(status).trim().toLowerCase();
  if (s === 'deregulated') return 'dereg';
  if (s === 'some deregulation') return 'some';
  if (s === 'unlikely' || s === 'no opportunity') return 'reg';
  return 'unknown';
}

// Color hex for each tier — used by the dot fill, country fill,
// table swatch, and legend block.
export const TIER_COLORS = {
  dereg:   '#16A34A',
  some:    '#F59E0B',
  reg:     '#DC2626',
  mixed:   '#64748B',
  unknown: '#94A3B8',
};

// Lighter "faded" variants for choropleth fill on countries the
// portfolio does not have sites in. Keeps the same hue so the dereg
// tier is still legible, but drops saturation so the with-sites
// countries pop.
export const TIER_COLORS_FADED = {
  dereg:   '#BBF7D0',
  some:    '#FDE68A',
  reg:     '#FECACA',
  mixed:   '#CBD5E1',
  unknown: '#E2E8F0',
};

export const TIER_LABELS = {
  dereg:   'Deregulated',
  some:    'Some deregulation',
  reg:     'Regulated / unlikely',
  mixed:   'Mixed (US / Canada)',
  unknown: 'No data',
};
