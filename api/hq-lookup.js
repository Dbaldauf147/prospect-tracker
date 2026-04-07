/**
 * Looks up company HQ location using HubSpot contact data.
 * POST /api/hq-lookup
 * Body: { companies: ["CBRE", "Prologis", ...] }
 * Returns: { results: { "CBRE": { region: "North America", location: "Dallas, Texas, United States" }, ... } }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { companies } = req.body;
  if (!companies?.length) return res.status(400).json({ error: 'companies array is required' });

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'HubSpot token not configured' });

  // Fetch contacts with location data
  let contacts = [];
  try {
    let after;
    while (true) {
      const params = new URLSearchParams({ limit: '100', properties: 'company,city,state,country' });
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

  // Build company → most common location
  const companyLocations = {};
  for (const c of contacts) {
    const co = (c.company || '').trim();
    if (!co) continue;
    const coLower = co.toLowerCase();
    const city = (c.city || '').trim();
    const state = (c.state || '').trim();
    const country = (c.country || '').trim();
    if (!city && !state && !country) continue;

    const locationKey = [city, state, country].filter(Boolean).join(', ');
    if (!companyLocations[coLower]) companyLocations[coLower] = {};
    companyLocations[coLower][locationKey] = (companyLocations[coLower][locationKey] || 0) + 1;
  }

  // For each company, pick the most common location
  const results = {};
  for (const company of companies) {
    const lower = company.toLowerCase().trim();

    // Try exact match, then partial
    let locCounts = companyLocations[lower];
    if (!locCounts) {
      for (const [key, val] of Object.entries(companyLocations)) {
        if (key.includes(lower) || lower.includes(key)) { locCounts = val; break; }
      }
    }

    if (locCounts && Object.keys(locCounts).length > 0) {
      // Pick the location with the most contacts
      const best = Object.entries(locCounts).sort((a, b) => b[1] - a[1])[0][0];
      results[company] = { region: '', location: best };
    } else {
      results[company] = { region: '', location: '' };
    }
  }

  return res.json({ results });
}
