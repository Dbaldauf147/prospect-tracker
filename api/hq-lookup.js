/**
 * Determines if companies are North America based using HubSpot contact data.
 * POST /api/hq-lookup
 * Body: { companies: ["CBRE", "Prologis", ...] }
 */

const NA_COUNTRIES = new Set([
  'united states', 'us', 'usa', 'u.s.', 'u.s.a.', 'america',
  'canada', 'ca', 'can',
  'mexico', 'mx', 'mex',
]);

const NA_STATES = new Set([
  // US states
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia',
  'hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts',
  'michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey',
  'new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia',
  'wisconsin','wyoming','district of columbia',
  // US state abbreviations
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma',
  'mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn',
  'tx','ut','vt','va','wa','wv','wi','wy','dc',
  // Canadian provinces
  'ontario','quebec','british columbia','alberta','manitoba','saskatchewan','nova scotia','new brunswick',
  'newfoundland','prince edward island','northwest territories','nunavut','yukon',
  'on','qc','bc','ab','mb','sk','ns','nb','nl','pe','nt','nu','yt',
]);

function isNorthAmerica(country, state, city) {
  const c = (country || '').toLowerCase().trim();
  const s = (state || '').toLowerCase().trim();
  if (c && NA_COUNTRIES.has(c)) return true;
  if (s && NA_STATES.has(s)) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { companies } = req.body;
  if (!companies || !Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ error: 'companies array is required' });
  }

  // Load HubSpot contacts from cache via API
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'HubSpot token not configured' });

  // Fetch contacts with location data
  let contacts = [];
  let after;
  const properties = ['company', 'city', 'state', 'country'].join(',');
  while (true) {
    const params = new URLSearchParams({ limit: '100', properties });
    if (after) params.set('after', after);
    const hubRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!hubRes.ok) break;
    const data = await hubRes.json();
    contacts.push(...(data.results || []).map(c => c.properties));
    if (data.paging?.next?.after) { after = data.paging.next.after; } else break;
    if (contacts.length > 5000) break;
  }

  // Build company → location map (majority vote from contacts)
  const companyLocations = {};
  for (const c of contacts) {
    const co = (c.company || '').toLowerCase().trim();
    if (!co) continue;
    if (!companyLocations[co]) companyLocations[co] = { na: 0, nonNa: 0, country: '', state: '', city: '' };
    if (isNorthAmerica(c.country, c.state, c.city)) {
      companyLocations[co].na++;
    } else if (c.country || c.state) {
      companyLocations[co].nonNa++;
    }
    if (c.country && !companyLocations[co].country) companyLocations[co].country = c.country;
    if (c.state && !companyLocations[co].state) companyLocations[co].state = c.state;
    if (c.city && !companyLocations[co].city) companyLocations[co].city = c.city;
  }

  // Match companies
  const results = {};
  for (const company of companies) {
    const lower = company.toLowerCase().trim();
    // Try exact match first, then partial
    let match = companyLocations[lower];
    if (!match) {
      for (const [key, val] of Object.entries(companyLocations)) {
        if (key.includes(lower) || lower.includes(key)) { match = val; break; }
      }
    }

    if (match && (match.na > 0 || match.nonNa > 0)) {
      const region = match.na >= match.nonNa ? 'North America' : 'Outside North America';
      const location = [match.city, match.state, match.country].filter(Boolean).join(', ');
      results[company] = { region, location };
    } else {
      results[company] = { region: 'Unknown', location: '' };
    }
  }

  return res.json({ results });
}
