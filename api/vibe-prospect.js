/**
 * Vercel serverless function: searches Apollo.io for prospects.
 * POST /api/vibe-prospect
 */

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Apollo API key not configured' });

  const filters = req.body.filters || req.body;
  if (!filters || Object.keys(filters).length === 0) return res.status(400).json({ error: 'Missing filters' });

  const limit = Math.min(filters.limit || 50, 100); // Apollo max 100 per page
  const totalRequested = filters.limit || 50;
  const pages = Math.min(Math.ceil(totalRequested / 100), 5); // Max 5 pages (500 results)

  // Parse company names from comma-separated string
  const companyNames = (filters.companyName || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Parse title keywords from newline-separated string
  const titlesInclude = (filters.titleKeywords || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const titlesExclude = (filters.titleExclude || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  // Build Apollo search params
  const searchParams = {
    per_page: Math.min(limit, 100),
    page: 1,
    ...(titlesInclude.length > 0 ? { person_titles: titlesInclude } : {}),
    ...(companyNames.length > 0 ? { q_organization_name: companyNames.join(' OR ') } : {}),
    ...(filters.country ? { person_locations: [filters.country === 'US' ? 'United States' : filters.country] } : {}),
    ...(filters.industry ? { q_organization_keyword_tags: [filters.industry] } : {}),
    ...(filters.hasEmail ? { contact_email_status: ['verified', 'guessed', 'unavailable'] } : {}),
  };

  try {
    let allPeople = [];

    for (let page = 1; page <= pages; page++) {
      const body = { ...searchParams, page };
      const apolloRes = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!apolloRes.ok) {
        const errText = await apolloRes.text();
        throw new Error(`Apollo API ${apolloRes.status}: ${errText.slice(0, 300)}`);
      }

      const data = await apolloRes.json();
      const people = data.people || [];
      allPeople.push(...people);

      // Stop if we have enough or no more results
      if (allPeople.length >= totalRequested || people.length < searchParams.per_page) break;
    }

    // Trim to requested amount
    allPeople = allPeople.slice(0, totalRequested);

    // Filter out excluded titles client-side
    if (titlesExclude.length > 0) {
      const excludeLower = titlesExclude.map(t => t.toLowerCase());
      allPeople = allPeople.filter(p => {
        const title = (p.title || '').toLowerCase();
        return !excludeLower.some(ex => title.includes(ex));
      });
    }

    // Map to consistent format
    const prospects = allPeople.map(p => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '),
      title: p.title,
      company: p.organization?.name || '',
      company_domain: p.organization?.website_url || '',
      email: p.email || '',
      email_status: p.email_status || '',
      phone: p.phone_number?.number || '',
      city: p.city,
      state: p.state,
      country: p.country,
      linkedin_url: p.linkedin_url || '',
      seniority: p.seniority,
      departments: p.departments || [],
    }));

    return res.status(200).json({
      prospects,
      total: prospects.length,
      source: 'apollo',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Apollo search failed' });
  }
}
