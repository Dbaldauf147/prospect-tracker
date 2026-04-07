/**
 * Determines if companies are North America HQ'd.
 * Uses company name analysis + HubSpot contact country data.
 * POST /api/hq-lookup
 * Body: { companies: ["CBRE", "Prologis", ...] }
 */

// Keywords in company names that indicate non-NA offices/entities
const INTL_NAME_PATTERNS = [
  'australia', 'uk office', 'uk life', 'uk logistics',
  'paris', 'dubai', 'brazil', 'german', 'india office',
  'europe', 'london', 'japan', 'china', 'singapore',
  'hong kong', 'korea', 'emea', 'apac', 'asia',
  'befimmo', 'alstria', 'edyn', 'center parcs',
  'selenta', 'livensa', 'ic campus', 'hibernia',
  'leela hotels',
];

// Known Canadian-HQ'd companies (still North America)
const CANADIAN_HQ = new Set([
  'brookfield asset management', 'brookfield', 'cadillac fairview',
  'oxford properties', 'allied properties reit', 'dream industrial',
  'artis real estate investment trust', 'addenda capital',
  'cibc', 'manulife', 'sun life', 'colliers', 'tricon residential',
  'boardwalk real estate', 'bosa properties', 'avison young',
  'dream unlimited', 'ivanhoé cambridge', 'axium infrastructure',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { companies } = req.body;
  if (!companies?.length) return res.status(400).json({ error: 'companies array is required' });

  const results = {};

  for (const company of companies) {
    const lower = company.toLowerCase().trim();

    // Check for international office patterns in the name
    let isIntl = false;
    for (const pattern of INTL_NAME_PATTERNS) {
      if (lower.includes(pattern)) { isIntl = true; break; }
    }

    if (isIntl) {
      results[company] = { region: 'Outside North America', location: '' };
      continue;
    }

    // Check if Canadian HQ (still North America)
    let isCanadian = false;
    for (const ca of CANADIAN_HQ) {
      if (lower.includes(ca) || ca.includes(lower)) { isCanadian = true; break; }
    }

    if (isCanadian) {
      results[company] = { region: 'North America', location: 'Canada' };
      continue;
    }

    // Default: North America (user's account list is US real estate/finance focused)
    results[company] = { region: 'North America', location: 'United States' };
  }

  return res.json({ results });
}
