/**
 * Returns verified company HQ locations from curated data.
 * POST /api/hq-lookup
 * Body: { companies: ["CBRE", "Prologis", ...] }
 */

// Verified HQ locations from Vibe Prospecting business firmographics
const VERIFIED_HQ = {
  'cbre': 'Dallas, Texas, United States',
  'prologis': 'San Francisco, California, United States',
  'simon property group': 'Indianapolis, Indiana, United States',
  'jones lang lasalle': 'Chicago, Illinois, United States',
  'jll': 'Chicago, Illinois, United States',
  'brookfield asset management': 'New York, New York, United States',
  'brookfield': 'New York, New York, United States',
  'goldman sachs': 'New York, New York, United States',
  'goldman sachs asset management': 'New York, New York, United States',
  'jp morgan': 'New York, New York, United States',
  'jp morgan asset management': 'New York, New York, United States',
  'jp morgan asset management real estate': 'New York, New York, United States',
  'nationwide': 'Scottsdale, Arizona, United States',
  'pnc': 'Pittsburgh, Pennsylvania, United States',
  'thoma bravo': 'Chicago, Illinois, United States',
  'blue owl capital': 'New York, New York, United States',
  'cerberus capital management': 'New York, New York, United States',
  'hellman & friedman': 'San Francisco, California, United States',
  'nuveen': 'Chicago, Illinois, United States',
  'nuveen real estate': 'Chicago, Illinois, United States',
  'ventas': 'Chicago, Illinois, United States',
  'hines': 'Houston, Texas, United States',
  'starwood capital group': 'Miami Beach, Florida, United States',
  'blackstone': 'New York, New York, United States',
  'kkr': 'New York, New York, United States',
  'apollo global management': 'New York, New York, United States',
  'invesco': 'Atlanta, Georgia, United States',
  'invesco real estate': 'Atlanta, Georgia, United States',
  'northern trust': 'Chicago, Illinois, United States',
  'deloitte': 'London, England, United Kingdom',
  'ey': 'London, England, United Kingdom',
  'ey consulting': 'London, England, United Kingdom',
  'pricewaterhousecoopers': 'London, England, United Kingdom',
  'price waterhouse coopers': 'London, England, United Kingdom',
  'pwc': 'London, England, United Kingdom',
  'kimco realty': 'Jericho, New York, United States',
  'kilroy realty': 'Los Angeles, California, United States',
  'macerich': 'Santa Monica, California, United States',
  'realty income': 'San Diego, California, United States',
  'american homes 4 rent': 'Monroe, Louisiana, United States',
  'equity lifestyle properties': 'Chicago, Illinois, United States',
  'ameriprise financial': 'Minneapolis, Minnesota, United States',
  'lpl financial': 'San Diego, California, United States',
  'sofi': 'San Francisco, California, United States',
  'bank ozk': 'Little Rock, Arkansas, United States',
  'popular inc': 'San Juan, Puerto Rico, United States',
  'popular': 'San Juan, Puerto Rico, United States',
  'costar group': 'Arlington, Virginia, United States',
  'lineage logistics': 'Novi, Michigan, United States',
  'pulte group': 'Atlanta, Georgia, United States',
  'lennar': 'Miami, Florida, United States',
  'lennar corp': 'Miami, Florida, United States',
  'silver lake': 'Menlo Park, California, United States',
  'harrison street': 'Chicago, Illinois, United States',
  'invitation homes': 'Dallas, Texas, United States',
  'park hotels & resorts': 'Tysons, Virginia, United States',
  'piedmont office realty trust': 'Atlanta, Georgia, United States',
  'principal financial group': 'Des Moines, Iowa, United States',
  'new york life': 'New York, New York, United States',
  'realterm': 'Annapolis, Maryland, United States',
  'rmr group': 'Newton, Massachusetts, United States',
  'affinius capital': 'San Antonio, Texas, United States',
  'article student living': 'Chicago, Illinois, United States',
  'bok financial': 'Tulsa, Oklahoma, United States',
  'cabot properties': 'Boston, Massachusetts, United States',
  'cadillac fairview': 'Toronto, Ontario, Canada',
  'cbre investment management': 'Los Angeles, California, United States',
  'cibc': 'Toronto, Ontario, Canada',
  'clayton dubilier & rice': 'New York, New York, United States',
  'community healthcare trust': 'Franklin, Tennessee, United States',
  'divcowest': 'San Francisco, California, United States',
  'diversified healthcare trust': 'Newton, Massachusetts, United States',
  'easterly government properties': 'Washington, District of Columbia, United States',
  'eastgroup properties': 'Ridgeland, Mississippi, United States',
  'edens': 'Columbia, South Carolina, United States',
  'education realty trust': 'Memphis, Tennessee, United States',
  'eos hospitality': 'Boston, Massachusetts, United States',
  'gbx group': 'Annapolis, Maryland, United States',
  'griffis residential': 'Denver, Colorado, United States',
  'hobbs brook real estate': 'Waltham, Massachusetts, United States',
  'industrious': 'New York, New York, United States',
  'international workplace group': 'Zug, Switzerland',
  'iwg': 'Zug, Switzerland',
  'jackson financial group': 'Lansing, Michigan, United States',
  'jamestown properties': 'Atlanta, Georgia, United States',
  'jamestown': 'Atlanta, Georgia, United States',
  'kite realty group trust': 'Indianapolis, Indiana, United States',
  'kite realty group': 'Indianapolis, Indiana, United States',
  'klein enterprises': 'Baltimore, Maryland, United States',
  'merritt properties': 'Baltimore, Maryland, United States',
  "moody's": 'New York, New York, United States',
  'moodys': 'New York, New York, United States',
  'store capital': 'Scottsdale, Arizona, United States',
  'bluerock residential growth reit': 'New York, New York, United States',
  'boxer properties': 'Houston, Texas, United States',
  'dream industrial': 'Toronto, Ontario, Canada',
  'berkeley partners': 'San Francisco, California, United States',
  // Additional known companies
  'cbre inc': 'Dallas, Texas, United States',
  'tishman speyer': 'New York, New York, United States',
  'trammell crow': 'Dallas, Texas, United States',
  'tricon residential': 'Toronto, Ontario, Canada',
  'usaa': 'San Antonio, Texas, United States',
  'vertiv': 'Westerville, Ohio, United States',
  'westinghouse': 'Cranberry Township, Pennsylvania, United States',
  'wework': 'New York, New York, United States',
  'whitestone reit': 'Houston, Texas, United States',
  'wilsonart': 'Austin, Texas, United States',
  'wsp global': 'Montreal, Quebec, Canada',
  'chubb': 'Zurich, Switzerland',
  'tiaa': 'New York, New York, United States',
  'liberty mutual': 'Boston, Massachusetts, United States',
  'edward jones': 'St. Louis, Missouri, United States',
  'amtrust financial': 'New York, New York, United States',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { companies } = req.body;
  if (!companies?.length) return res.status(400).json({ error: 'companies array is required' });

  const results = {};

  for (const company of companies) {
    const lower = company.toLowerCase().trim();

    // Try exact match first
    if (VERIFIED_HQ[lower]) {
      results[company] = { location: VERIFIED_HQ[lower] };
      continue;
    }

    // Try partial match
    let found = false;
    for (const [key, loc] of Object.entries(VERIFIED_HQ)) {
      if (lower.includes(key) || key.includes(lower)) {
        results[company] = { location: loc };
        found = true;
        break;
      }
    }

    if (!found) {
      results[company] = { location: '' };
    }
  }

  return res.json({ results });
}
