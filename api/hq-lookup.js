/**
 * Determines if companies are North America HQ'd.
 * Uses: known international company list + HubSpot contact country data.
 * POST /api/hq-lookup
 * Body: { companies: ["CBRE", "Prologis", ...] }
 */

// Companies known to be headquartered outside North America
const KNOWN_INTERNATIONAL = new Set([
  // UK
  'legal & general', 'aviva', 'schroders', 'man group', 'abrdn', 'landsec', 'british land',
  'segro', 'hammerson', 'unite group', 'savills', 'grosvenor', 'lendlease',
  // Europe
  'allianz', 'axa', 'bnp paribas', 'credit suisse', 'ubs', 'swiss re', 'zurich insurance',
  'unibail-rodamco-westfield', 'vonovia', 'gecina', 'klepierra', 'covivio',
  'patrizia', 'commerz real', 'deka', 'union investment', 'amundi', 'antin infrastructure partners',
  // Asia/Pacific
  'mitsui fudosan', 'mitsubishi estate', 'capitaland', 'mapletree', 'gic', 'temasek',
  'sun hung kai', 'cheung kong', 'link reit', 'swire properties',
  // Canada (NA but sometimes flagged)
  'brookfield asset management', 'brookfield', 'cadillac fairview', 'oxford properties',
  'allied properties reit', 'dream industrial', 'artis real estate investment trust',
  'addenda capital', 'cibc', 'manulife', 'sun life', 'ivanhoé cambridge',
  'alberta investment management corporation', 'aimco',
  // Australia
  'macquarie', 'dexus', 'goodman group', 'stockland', 'mirvac', 'charter hall',
]);

// Canadian companies — still North America
const KNOWN_CANADIAN = new Set([
  'brookfield asset management', 'brookfield', 'cadillac fairview', 'oxford properties',
  'allied properties reit', 'dream industrial', 'artis real estate investment trust',
  'addenda capital', 'cibc', 'manulife', 'sun life', 'ivanhoé cambridge',
  'alberta investment management corporation', 'aimco', 'dream unlimited',
  'colliers', 'colliers international', 'firstservice', 'tricon residential',
]);

const NA_COUNTRY_TERMS = new Set([
  'united states', 'us', 'usa', 'u.s.', 'u.s.a.', 'america',
  'canada', 'ca', 'can', 'mexico', 'mx', 'mex',
  'puerto rico', 'pr',
]);

const US_STATES = new Set([
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia',
  'hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts',
  'michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey',
  'new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia',
  'wisconsin','wyoming','district of columbia',
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma',
  'mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn',
  'tx','ut','vt','va','wa','wv','wi','wy','dc',
  'ontario','quebec','british columbia','alberta','manitoba','saskatchewan','nova scotia','new brunswick',
  'on','qc','bc','ab','mb','sk','ns','nb','nl','pe','nt','nu','yt',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { companies } = req.body;
  if (!companies?.length) return res.status(400).json({ error: 'companies array is required' });

  const token = process.env.HUBSPOT_ACCESS_TOKEN;

  // Fetch HubSpot contacts for location data
  let contacts = [];
  if (token) {
    try {
      let after;
      const properties = 'company,city,state,country';
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
    } catch {}
  }

  // Build company → NA signal map from contacts
  const contactSignals = {};
  for (const c of contacts) {
    const co = (c.company || '').trim();
    if (!co) continue;
    const coLower = co.toLowerCase();
    if (!contactSignals[coLower]) contactSignals[coLower] = { na: 0, other: 0, country: '', state: '' };
    const country = (c.country || '').toLowerCase().trim();
    const state = (c.state || '').toLowerCase().trim();
    if (NA_COUNTRY_TERMS.has(country) || US_STATES.has(state)) {
      contactSignals[coLower].na++;
      if (!contactSignals[coLower].country) contactSignals[coLower].country = c.country || '';
      if (!contactSignals[coLower].state) contactSignals[coLower].state = c.state || '';
    } else if (country) {
      contactSignals[coLower].other++;
      if (!contactSignals[coLower].country) contactSignals[coLower].country = c.country || '';
    }
  }

  const results = {};

  for (const company of companies) {
    const lower = company.toLowerCase().trim();

    // 1. Check known international list (but Canadian companies are NA)
    if (KNOWN_CANADIAN.has(lower)) {
      results[company] = { region: 'North America', location: 'Canada' };
      continue;
    }

    let isKnownIntl = false;
    for (const intl of KNOWN_INTERNATIONAL) {
      if (lower.includes(intl) || intl.includes(lower)) { isKnownIntl = true; break; }
    }
    if (isKnownIntl && !KNOWN_CANADIAN.has(lower)) {
      results[company] = { region: 'Outside North America', location: '' };
      continue;
    }

    // 2. Check HubSpot contact data
    let signal = contactSignals[lower];
    if (!signal) {
      // Try partial match
      for (const [key, val] of Object.entries(contactSignals)) {
        if (key.includes(lower) || lower.includes(key)) { signal = val; break; }
      }
    }

    if (signal && (signal.na > 0 || signal.other > 0)) {
      // Use majority of contacts with location data
      if (signal.na > 0 && signal.na >= signal.other) {
        results[company] = { region: 'North America', location: [signal.state, signal.country].filter(Boolean).join(', ') };
      } else if (signal.other > signal.na) {
        results[company] = { region: 'Outside North America', location: signal.country };
      } else {
        // Default to NA for US-focused real estate/finance companies
        results[company] = { region: 'North America', location: '' };
      }
      continue;
    }

    // 3. Default: most US real estate/finance companies are NA-based
    // Flag as NA by default since the user's account list is US-focused
    results[company] = { region: 'North America', location: '' };
  }

  return res.json({ results });
}
