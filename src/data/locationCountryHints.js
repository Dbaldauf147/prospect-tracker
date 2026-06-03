// Heuristic country inference from a site's City / State-Province text,
// used as a LAST-RESORT fallback on the Utility Lookup page when an
// upload has no Country column and the site doesn't resolve to a US/CA
// state (so it would otherwise be dropped from the Indicative Savings
// export, which buckets every site by state-or-country).
//
// This is indicative, not authoritative: a curated gazetteer can never
// be exhaustive, and 2-letter province codes are deliberately avoided
// where they collide with US state codes. Returned country names are
// canonical forms that match the COUNTRY_RATES / COUNTRY_DEREGULATION
// references. Extend the two tables below as new regions show up.
//
// Reuses the EU / North-America city list in cities.js for European
// cities; this file adds the rest of the world plus subdivision hints.

import { getStateForCity } from './cities';

// Normalize a free-text place name for table lookups: lowercase, strip
// diacritics, drop punctuation, collapse whitespace.
function norm(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// State / province / region → country. Keyed on the normalized region
// name. Strong signal for international sites whose State column holds a
// province rather than a US state. Full names preferred over ambiguous
// abbreviations.
const REGION_TO_COUNTRY = {
  // Brazil
  'sao paulo': 'Brazil', 'rio de janeiro': 'Brazil', 'minas gerais': 'Brazil',
  'parana': 'Brazil', 'bahia': 'Brazil', 'rio grande do sul': 'Brazil',
  'santa catarina': 'Brazil', 'pernambuco': 'Brazil', 'ceara': 'Brazil', 'goias': 'Brazil',
  // United Kingdom (counties / regions — see also the "-shire" rule below)
  'cambridgeshire': 'United Kingdom', 'northamptonshire': 'United Kingdom',
  'worcestershire': 'United Kingdom', 'oxfordshire': 'United Kingdom',
  'hampshire': 'United Kingdom', 'lancashire': 'United Kingdom', 'cheshire': 'United Kingdom',
  'yorkshire': 'United Kingdom', 'derbyshire': 'United Kingdom', 'staffordshire': 'United Kingdom',
  'devon': 'United Kingdom', 'cornwall': 'United Kingdom', 'kent': 'United Kingdom',
  'surrey': 'United Kingdom', 'essex': 'United Kingdom', 'norfolk': 'United Kingdom',
  'suffolk': 'United Kingdom', 'greater london': 'United Kingdom', 'west midlands': 'United Kingdom',
  'merseyside': 'United Kingdom', 'greater manchester': 'United Kingdom', 'berkshire': 'United Kingdom',
  // Italy (regions + common provinces)
  'lombardy': 'Italy', 'lombardia': 'Italy', 'lazio': 'Italy', 'piedmont': 'Italy', 'piemonte': 'Italy',
  'tuscany': 'Italy', 'toscana': 'Italy', 'veneto': 'Italy', 'emilia romagna': 'Italy',
  'milan': 'Italy', 'milano': 'Italy', 'roma': 'Italy', 'torino': 'Italy',
  // Germany (Länder)
  'bavaria': 'Germany', 'bayern': 'Germany', 'hesse': 'Germany', 'hessen': 'Germany',
  'north rhine westphalia': 'Germany', 'nordrhein westfalen': 'Germany',
  'baden wurttemberg': 'Germany', 'lower saxony': 'Germany', 'niedersachsen': 'Germany',
  'saxony': 'Germany', 'sachsen': 'Germany', 'schleswig holstein': 'Germany', 'rhineland palatinate': 'Germany',
  // France (regions + the Eure-et-Loir département around Épernon)
  'ile de france': 'France', 'grand est': 'France', 'normandy': 'France', 'normandie': 'France',
  'brittany': 'France', 'bretagne': 'France', 'occitanie': 'France', 'nouvelle aquitaine': 'France',
  'auvergne rhone alpes': 'France', 'hauts de france': 'France', 'eure et loir': 'France',
  // China (provinces / municipalities / districts)
  'shanghai': 'China', 'beijing': 'China', 'guangdong': 'China', 'jiangsu': 'China',
  'zhejiang': 'China', 'shandong': 'China', 'sichuan': 'China', 'hubei': 'China',
  'fujian': 'China', 'tianjin': 'China', 'qingpu': 'China',
  // Malaysia (states)
  'pahang': 'Malaysia', 'selangor': 'Malaysia', 'johor': 'Malaysia', 'penang': 'Malaysia',
  'pulau pinang': 'Malaysia', 'sabah': 'Malaysia', 'sarawak': 'Malaysia', 'perak': 'Malaysia',
  'kedah': 'Malaysia', 'kelantan': 'Malaysia', 'negeri sembilan': 'Malaysia', 'melaka': 'Malaysia',
  // Philippines (provinces / regions)
  'cavite': 'Philippines', 'laguna': 'Philippines', 'batangas': 'Philippines', 'cebu': 'Philippines',
  'metro manila': 'Philippines', 'rizal': 'Philippines', 'pampanga': 'Philippines', 'bulacan': 'Philippines',
  // Russia
  'volgograd': 'Russia', 'moscow': 'Russia', 'moskva': 'Russia', 'saint petersburg': 'Russia',
  'leningrad': 'Russia', 'tatarstan': 'Russia', 'sverdlovsk': 'Russia',
  // India (states)
  'maharashtra': 'India', 'karnataka': 'India', 'tamil nadu': 'India', 'gujarat': 'India',
  'haryana': 'India', 'uttar pradesh': 'India', 'telangana': 'India', 'west bengal': 'India',
};

// Supplemental world cities (beyond the EU / North-America list in
// cities.js). Keyed on the normalized city name → country. Cities that
// collide with a well-known US city (e.g. "Cambridge") are intentionally
// omitted so they don't mis-tag.
const CITY_TO_COUNTRY = {
  // Brazil
  'sao paulo': 'Brazil', 'guarulhos': 'Brazil', 'jaguariuna': 'Brazil', 'campinas': 'Brazil',
  'belo horizonte': 'Brazil', 'curitiba': 'Brazil', 'porto alegre': 'Brazil', 'brasilia': 'Brazil',
  // China
  'shanghai': 'China', 'beijing': 'China', 'shenzhen': 'China', 'guangzhou': 'China',
  'suzhou': 'China', 'hangzhou': 'China', 'chengdu': 'China', 'tianjin': 'China', 'qingpu': 'China',
  // Malaysia
  'kuantan': 'Malaysia', 'kuala lumpur': 'Malaysia', 'george town': 'Malaysia',
  'johor bahru': 'Malaysia', 'shah alam': 'Malaysia', 'petaling jaya': 'Malaysia',
  // Philippines
  'cavite': 'Philippines', 'manila': 'Philippines', 'makati': 'Philippines',
  'quezon city': 'Philippines', 'cebu': 'Philippines', 'taguig': 'Philippines',
  // Russia
  'volgograd': 'Russia', 'moscow': 'Russia', 'saint petersburg': 'Russia',
  'kazan': 'Russia', 'novosibirsk': 'Russia', 'yekaterinburg': 'Russia',
  // Germany / France / UK cities not in cities.js
  'norderstedt': 'Germany', 'nuremberg': 'Germany', 'leipzig': 'Germany',
  'epernon': 'France', 'lille': 'France', 'nantes': 'France', 'bordeaux': 'France', 'strasbourg': 'France',
  'st neots': 'United Kingdom', 'kettering': 'United Kingdom', 'malvern': 'United Kingdom',
  'milton keynes': 'United Kingdom', 'reading': 'United Kingdom', 'swindon': 'United Kingdom',
  // India
  'mumbai': 'India', 'bengaluru': 'India', 'bangalore': 'India', 'new delhi': 'India',
  'chennai': 'India', 'pune': 'India', 'hyderabad': 'India', 'kolkata': 'India',
  'gurgaon': 'India', 'gurugram': 'India', 'noida': 'India', 'ahmedabad': 'India',
  // Other major hubs
  'tokyo': 'Japan', 'osaka': 'Japan', 'yokohama': 'Japan', 'nagoya': 'Japan',
  'seoul': 'South Korea', 'busan': 'South Korea',
  'singapore': 'Singapore', 'bangkok': 'Thailand', 'jakarta': 'Indonesia',
  'ho chi minh city': 'Vietnam', 'hanoi': 'Vietnam',
  'sydney': 'Australia', 'melbourne': 'Australia', 'brisbane': 'Australia',
  'mexico city': 'Mexico', 'monterrey': 'Mexico', 'guadalajara': 'Mexico',
  'dubai': 'United Arab Emirates', 'abu dhabi': 'United Arab Emirates',
  'istanbul': 'Turkey', 'ankara': 'Turkey', 'johannesburg': 'South Africa', 'cape town': 'South Africa',
  'buenos aires': 'Argentina', 'santiago': 'Chile', 'bogota': 'Colombia', 'lima': 'Peru',
};

// Pull candidate place tokens out of a compound city string like
// "Passirana di Rho (Milan)" or "Shanghai (Qingpu)" — the whole string,
// the parenthetical, and the leading segment.
function cityCandidates(rawCity) {
  const out = new Set();
  const whole = String(rawCity || '').trim();
  if (!whole) return [];
  out.add(whole);
  const paren = whole.match(/\(([^)]+)\)/);
  if (paren) out.add(paren[1]);
  out.add(whole.replace(/\([^)]*\)/g, '').trim()); // strip parenthetical
  out.add(whole.split(/[,–—-]/)[0].trim()); // before comma / dash
  return [...out].filter(Boolean);
}

// Infer a canonical country from a site's city and/or region text.
// Region (province/state) is checked first — it's the stronger signal
// for international sites — then the city tables and the shared EU/NAM
// gazetteer. Returns a canonical country name, or null when nothing
// matches confidently.
export function inferCountryFromLocation({ city, region } = {}) {
  const regionKey = norm(region);
  if (regionKey) {
    if (REGION_TO_COUNTRY[regionKey]) return REGION_TO_COUNTRY[regionKey];
    // UK counties very often end in "-shire" without being individually listed.
    if (/\bshire$/.test(regionKey)) return 'United Kingdom';
  }
  for (const cand of cityCandidates(city)) {
    const key = norm(cand);
    if (!key) continue;
    if (CITY_TO_COUNTRY[key]) return CITY_TO_COUNTRY[key];
    // Region table also covers some city-named provinces (Milan, Shanghai…).
    if (REGION_TO_COUNTRY[key]) return REGION_TO_COUNTRY[key];
    // Fall back to the curated EU / North-America city gazetteer.
    const hit = getStateForCity(cand);
    if (hit && hit.country) return hit.country;
  }
  return null;
}
