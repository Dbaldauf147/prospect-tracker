// Predictive-text suggestions for the City field on contact records,
// plus a small "what state / country is this city in?" lookup so the
// modal can auto-fill State for unambiguous cities without round-
// tripping to a geocoder. Cities that share a name across multiple
// US states (Portland, Kansas City, Arlington, etc.) intentionally
// have no `state` so the modal leaves State alone.

const NAM = [
  // US — major metros / business hubs. `state` uses the canonical
  // long form (matches src/data/enums.js US_STATES). Cities marked
  // `ambiguous: true` deliberately omit `state` because more than one
  // well-known US city shares the name.
  { name: 'New York City', aliases: ['NYC', 'New York', 'Manhattan'], state: 'New York', country: 'United States' },
  { name: 'Brooklyn', state: 'New York', country: 'United States' },
  { name: 'Queens', state: 'New York', country: 'United States' },
  { name: 'Boston', state: 'Massachusetts', country: 'United States' },
  { name: 'Cambridge', state: 'Massachusetts', country: 'United States' },
  { name: 'Philadelphia', aliases: ['Philly'], state: 'Pennsylvania', country: 'United States' },
  { name: 'Pittsburgh', state: 'Pennsylvania', country: 'United States' },
  { name: 'Washington', aliases: ['Washington DC', 'DC', 'Washington D.C.'], state: 'District of Columbia', country: 'United States' },
  { name: 'Arlington', ambiguous: true, country: 'United States' }, // VA vs TX
  { name: 'Bethesda', state: 'Maryland', country: 'United States' },
  { name: 'Alexandria', state: 'Virginia', country: 'United States' },
  { name: 'Atlanta', state: 'Georgia', country: 'United States' },
  { name: 'Charlotte', state: 'North Carolina', country: 'United States' },
  { name: 'Raleigh', state: 'North Carolina', country: 'United States' },
  { name: 'Durham', state: 'North Carolina', country: 'United States' },
  { name: 'Nashville', state: 'Tennessee', country: 'United States' },
  { name: 'Memphis', state: 'Tennessee', country: 'United States' },
  { name: 'Miami', state: 'Florida', country: 'United States' },
  { name: 'Fort Lauderdale', state: 'Florida', country: 'United States' },
  { name: 'Tampa', state: 'Florida', country: 'United States' },
  { name: 'Orlando', state: 'Florida', country: 'United States' },
  { name: 'Jacksonville', state: 'Florida', country: 'United States' },
  { name: 'Houston', state: 'Texas', country: 'United States' },
  { name: 'Dallas', state: 'Texas', country: 'United States' },
  { name: 'Fort Worth', state: 'Texas', country: 'United States' },
  { name: 'Austin', state: 'Texas', country: 'United States' },
  { name: 'San Antonio', state: 'Texas', country: 'United States' },
  { name: 'El Paso', state: 'Texas', country: 'United States' },
  { name: 'New Orleans', aliases: ['NOLA'], state: 'Louisiana', country: 'United States' },
  { name: 'Chicago', state: 'Illinois', country: 'United States' },
  { name: 'Detroit', state: 'Michigan', country: 'United States' },
  { name: 'Cleveland', state: 'Ohio', country: 'United States' },
  { name: 'Cincinnati', state: 'Ohio', country: 'United States' },
  { name: 'Columbus', state: 'Ohio', country: 'United States' },
  { name: 'Indianapolis', state: 'Indiana', country: 'United States' },
  { name: 'Milwaukee', state: 'Wisconsin', country: 'United States' },
  { name: 'Minneapolis', state: 'Minnesota', country: 'United States' },
  { name: 'St. Paul', aliases: ['Saint Paul'], state: 'Minnesota', country: 'United States' },
  { name: 'St. Louis', aliases: ['Saint Louis'], state: 'Missouri', country: 'United States' },
  { name: 'Kansas City', aliases: ['KC'], ambiguous: true, country: 'United States' }, // MO vs KS
  { name: 'Omaha', state: 'Nebraska', country: 'United States' },
  { name: 'Des Moines', state: 'Iowa', country: 'United States' },
  { name: 'Denver', state: 'Colorado', country: 'United States' },
  { name: 'Boulder', state: 'Colorado', country: 'United States' },
  { name: 'Salt Lake City', aliases: ['SLC'], state: 'Utah', country: 'United States' },
  { name: 'Phoenix', state: 'Arizona', country: 'United States' },
  { name: 'Scottsdale', state: 'Arizona', country: 'United States' },
  { name: 'Tucson', state: 'Arizona', country: 'United States' },
  { name: 'Las Vegas', aliases: ['Vegas'], state: 'Nevada', country: 'United States' },
  { name: 'Albuquerque', state: 'New Mexico', country: 'United States' },
  { name: 'San Francisco', aliases: ['SF', 'San Fran'], state: 'California', country: 'United States' },
  { name: 'San Jose', state: 'California', country: 'United States' },
  { name: 'Oakland', state: 'California', country: 'United States' },
  { name: 'Palo Alto', state: 'California', country: 'United States' },
  { name: 'Mountain View', state: 'California', country: 'United States' },
  { name: 'Berkeley', state: 'California', country: 'United States' },
  { name: 'Sacramento', state: 'California', country: 'United States' },
  { name: 'Los Angeles', aliases: ['LA'], state: 'California', country: 'United States' },
  { name: 'Beverly Hills', state: 'California', country: 'United States' },
  { name: 'Santa Monica', state: 'California', country: 'United States' },
  { name: 'Long Beach', state: 'California', country: 'United States' },
  { name: 'Anaheim', state: 'California', country: 'United States' },
  { name: 'San Diego', state: 'California', country: 'United States' },
  { name: 'Irvine', state: 'California', country: 'United States' },
  { name: 'Portland', ambiguous: true, country: 'United States' }, // OR vs ME
  { name: 'Seattle', state: 'Washington', country: 'United States' },
  { name: 'Bellevue', state: 'Washington', country: 'United States' },
  { name: 'Tacoma', state: 'Washington', country: 'United States' },
  { name: 'Honolulu', state: 'Hawaii', country: 'United States' },
  // Canada
  { name: 'Toronto', state: 'Ontario', country: 'Canada' },
  { name: 'Mississauga', state: 'Ontario', country: 'Canada' },
  { name: 'Brampton', state: 'Ontario', country: 'Canada' },
  { name: 'Markham', state: 'Ontario', country: 'Canada' },
  { name: 'Montreal', state: 'Quebec', country: 'Canada' },
  { name: 'Quebec City', state: 'Quebec', country: 'Canada' },
  { name: 'Vancouver', state: 'British Columbia', country: 'Canada' },
  { name: 'Burnaby', state: 'British Columbia', country: 'Canada' },
  { name: 'Surrey', state: 'British Columbia', country: 'Canada' },
  { name: 'Calgary', state: 'Alberta', country: 'Canada' },
  { name: 'Edmonton', state: 'Alberta', country: 'Canada' },
  { name: 'Ottawa', state: 'Ontario', country: 'Canada' },
  { name: 'Winnipeg', state: 'Manitoba', country: 'Canada' },
  { name: 'Halifax', state: 'Nova Scotia', country: 'Canada' },
];

const EU = [
  { name: 'London', country: 'United Kingdom' },
  { name: 'Manchester', country: 'United Kingdom' },
  { name: 'Birmingham', country: 'United Kingdom' },
  { name: 'Edinburgh', country: 'United Kingdom' },
  { name: 'Glasgow', country: 'United Kingdom' },
  { name: 'Dublin', country: 'Ireland' },
  { name: 'Cork', country: 'Ireland' },
  { name: 'Galway', country: 'Ireland' },
  { name: 'Paris', country: 'France' },
  { name: 'Lyon', country: 'France' },
  { name: 'Marseille', country: 'France' },
  { name: 'Berlin', country: 'Germany' },
  { name: 'Frankfurt', country: 'Germany' },
  { name: 'Munich', aliases: ['München'], country: 'Germany' },
  { name: 'Hamburg', country: 'Germany' },
  { name: 'Cologne', aliases: ['Köln'], country: 'Germany' },
  { name: 'Dusseldorf', aliases: ['Düsseldorf'], country: 'Germany' },
  { name: 'Stuttgart', country: 'Germany' },
  { name: 'Amsterdam', country: 'Netherlands' },
  { name: 'Rotterdam', country: 'Netherlands' },
  { name: 'The Hague', aliases: ['Den Haag'], country: 'Netherlands' },
  { name: 'Brussels', aliases: ['Bruxelles'], country: 'Belgium' },
  { name: 'Antwerp', aliases: ['Antwerpen'], country: 'Belgium' },
  { name: 'Luxembourg', country: 'Luxembourg' },
  { name: 'Madrid', country: 'Spain' },
  { name: 'Barcelona', country: 'Spain' },
  { name: 'Valencia', country: 'Spain' },
  { name: 'Lisbon', aliases: ['Lisboa'], country: 'Portugal' },
  { name: 'Porto', country: 'Portugal' },
  { name: 'Milan', aliases: ['Milano'], country: 'Italy' },
  { name: 'Rome', aliases: ['Roma'], country: 'Italy' },
  { name: 'Turin', aliases: ['Torino'], country: 'Italy' },
  { name: 'Stockholm', country: 'Sweden' },
  { name: 'Gothenburg', aliases: ['Göteborg'], country: 'Sweden' },
  { name: 'Copenhagen', aliases: ['København'], country: 'Denmark' },
  { name: 'Oslo', country: 'Norway' },
  { name: 'Helsinki', country: 'Finland' },
  { name: 'Zurich', aliases: ['Zürich'], country: 'Switzerland' },
  { name: 'Geneva', aliases: ['Genève'], country: 'Switzerland' },
  { name: 'Basel', country: 'Switzerland' },
  { name: 'Bern', country: 'Switzerland' },
  { name: 'Vienna', aliases: ['Wien'], country: 'Austria' },
  { name: 'Warsaw', aliases: ['Warszawa'], country: 'Poland' },
  { name: 'Krakow', aliases: ['Kraków', 'Cracow'], country: 'Poland' },
  { name: 'Prague', aliases: ['Praha'], country: 'Czechia' },
  { name: 'Budapest', country: 'Hungary' },
  { name: 'Bucharest', aliases: ['București'], country: 'Romania' },
  { name: 'Athens', aliases: ['Athína'], country: 'Greece' },
];

export const CITY_OPTIONS = [...NAM, ...EU];

// Match a query against a city's name OR any of its aliases. Returns
// the canonical names. Substring, case-insensitive.
export function matchCities(query, options = CITY_OPTIONS) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return options.map(o => o.name);
  const out = [];
  const seen = new Set();
  for (const opt of options) {
    const haystacks = [opt.name, ...(opt.aliases || [])];
    if (haystacks.some(h => h.toLowerCase().includes(q))) {
      if (!seen.has(opt.name)) {
        seen.add(opt.name);
        out.push(opt.name);
      }
    }
  }
  return out;
}

// Look up a city in the curated list and return its state / country
// when the name is unambiguous. Cities marked `ambiguous: true` (e.g.,
// Portland, Kansas City, Arlington) return null so the caller leaves
// the State field alone. Match is exact on the canonical name first,
// then by alias.
export function getStateForCity(name) {
  const q = String(name || '').trim().toLowerCase();
  if (!q) return null;
  for (const opt of CITY_OPTIONS) {
    if (opt.name.toLowerCase() === q) {
      if (opt.ambiguous) return null;
      return { state: opt.state || '', country: opt.country || '' };
    }
  }
  for (const opt of CITY_OPTIONS) {
    if ((opt.aliases || []).some(a => a.toLowerCase() === q)) {
      if (opt.ambiguous) return null;
      return { state: opt.state || '', country: opt.country || '' };
    }
  }
  return null;
}

// Look up a contact's State / Country from a free-text City via the
// public OpenStreetMap Nominatim search API. Returns full state name
// (e.g. "California") so it lines up with the US_STATES enum, plus
// the resolved country. Returns null on any failure — callers should
// silently no-op in that case rather than blocking the save. Used as
// the fallback when a city isn't in the curated CITY_OPTIONS list.
export async function lookupStateForCity(city, countryHint) {
  const trimmed = (city || '').trim();
  if (trimmed.length < 2) return null;
  try {
    const params = new URLSearchParams({
      city: trimmed,
      format: 'json',
      addressdetails: '1',
      limit: '1',
    });
    const ch = (countryHint || '').trim();
    if (ch) params.set('country', ch);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const addr = data[0].address || {};
    return {
      state: addr.state || addr.region || addr.province || '',
      country: addr.country || '',
    };
  } catch {
    return null;
  }
}
