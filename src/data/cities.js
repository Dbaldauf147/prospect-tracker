// Predictive-text suggestions for the City field on contact records.
// Two regional sets — NAM (US + Canada major business hubs) and EU
// (Western/Central Europe major financial / corporate cities). Each
// entry has a canonical `name` plus optional `aliases` so the city
// autocomplete can match alternate spellings ("NYC" → "New York
// City") without storing the alias as the saved value.

const NAM = [
  // US — major metros / business hubs
  { name: 'New York City', aliases: ['NYC', 'New York', 'Manhattan'] },
  { name: 'Brooklyn' },
  { name: 'Queens' },
  { name: 'Boston' },
  { name: 'Cambridge' },
  { name: 'Philadelphia', aliases: ['Philly'] },
  { name: 'Pittsburgh' },
  { name: 'Washington', aliases: ['Washington DC', 'DC', 'Washington D.C.'] },
  { name: 'Arlington' },
  { name: 'Bethesda' },
  { name: 'Alexandria' },
  { name: 'Atlanta' },
  { name: 'Charlotte' },
  { name: 'Raleigh' },
  { name: 'Durham' },
  { name: 'Nashville' },
  { name: 'Memphis' },
  { name: 'Miami' },
  { name: 'Fort Lauderdale' },
  { name: 'Tampa' },
  { name: 'Orlando' },
  { name: 'Jacksonville' },
  { name: 'Houston' },
  { name: 'Dallas' },
  { name: 'Fort Worth' },
  { name: 'Austin' },
  { name: 'San Antonio' },
  { name: 'El Paso' },
  { name: 'New Orleans', aliases: ['NOLA'] },
  { name: 'Chicago' },
  { name: 'Detroit' },
  { name: 'Cleveland' },
  { name: 'Cincinnati' },
  { name: 'Columbus' },
  { name: 'Indianapolis' },
  { name: 'Milwaukee' },
  { name: 'Minneapolis' },
  { name: 'St. Paul', aliases: ['Saint Paul'] },
  { name: 'St. Louis', aliases: ['Saint Louis'] },
  { name: 'Kansas City', aliases: ['KC'] },
  { name: 'Omaha' },
  { name: 'Des Moines' },
  { name: 'Denver' },
  { name: 'Boulder' },
  { name: 'Salt Lake City', aliases: ['SLC'] },
  { name: 'Phoenix' },
  { name: 'Scottsdale' },
  { name: 'Tucson' },
  { name: 'Las Vegas', aliases: ['Vegas'] },
  { name: 'Albuquerque' },
  { name: 'San Francisco', aliases: ['SF', 'San Fran'] },
  { name: 'San Jose' },
  { name: 'Oakland' },
  { name: 'Palo Alto' },
  { name: 'Mountain View' },
  { name: 'Berkeley' },
  { name: 'Sacramento' },
  { name: 'Los Angeles', aliases: ['LA'] },
  { name: 'Beverly Hills' },
  { name: 'Santa Monica' },
  { name: 'Long Beach' },
  { name: 'Anaheim' },
  { name: 'San Diego' },
  { name: 'Irvine' },
  { name: 'Portland' },
  { name: 'Seattle' },
  { name: 'Bellevue' },
  { name: 'Tacoma' },
  { name: 'Honolulu' },
  // Canada
  { name: 'Toronto' },
  { name: 'Mississauga' },
  { name: 'Brampton' },
  { name: 'Markham' },
  { name: 'Montreal' },
  { name: 'Quebec City' },
  { name: 'Vancouver' },
  { name: 'Burnaby' },
  { name: 'Surrey' },
  { name: 'Calgary' },
  { name: 'Edmonton' },
  { name: 'Ottawa' },
  { name: 'Winnipeg' },
  { name: 'Halifax' },
];

const EU = [
  { name: 'London' },
  { name: 'Manchester' },
  { name: 'Birmingham' },
  { name: 'Edinburgh' },
  { name: 'Glasgow' },
  { name: 'Dublin' },
  { name: 'Cork' },
  { name: 'Galway' },
  { name: 'Paris' },
  { name: 'Lyon' },
  { name: 'Marseille' },
  { name: 'Berlin' },
  { name: 'Frankfurt' },
  { name: 'Munich', aliases: ['München'] },
  { name: 'Hamburg' },
  { name: 'Cologne', aliases: ['Köln'] },
  { name: 'Dusseldorf', aliases: ['Düsseldorf'] },
  { name: 'Stuttgart' },
  { name: 'Amsterdam' },
  { name: 'Rotterdam' },
  { name: 'The Hague', aliases: ['Den Haag'] },
  { name: 'Brussels', aliases: ['Bruxelles'] },
  { name: 'Antwerp', aliases: ['Antwerpen'] },
  { name: 'Luxembourg' },
  { name: 'Madrid' },
  { name: 'Barcelona' },
  { name: 'Valencia' },
  { name: 'Lisbon', aliases: ['Lisboa'] },
  { name: 'Porto' },
  { name: 'Milan', aliases: ['Milano'] },
  { name: 'Rome', aliases: ['Roma'] },
  { name: 'Turin', aliases: ['Torino'] },
  { name: 'Stockholm' },
  { name: 'Gothenburg', aliases: ['Göteborg'] },
  { name: 'Copenhagen', aliases: ['København'] },
  { name: 'Oslo' },
  { name: 'Helsinki' },
  { name: 'Zurich', aliases: ['Zürich'] },
  { name: 'Geneva', aliases: ['Genève'] },
  { name: 'Basel' },
  { name: 'Bern' },
  { name: 'Vienna', aliases: ['Wien'] },
  { name: 'Warsaw', aliases: ['Warszawa'] },
  { name: 'Krakow', aliases: ['Kraków', 'Cracow'] },
  { name: 'Prague', aliases: ['Praha'] },
  { name: 'Budapest' },
  { name: 'Bucharest', aliases: ['București'] },
  { name: 'Athens', aliases: ['Athína'] },
];

export const CITY_OPTIONS = [...NAM, ...EU];

// Match a query against a city's name OR any of its aliases. Returns
// the canonical name when there's a hit; null otherwise. Substring,
// case-insensitive.
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
