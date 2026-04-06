/**
 * Vercel serverless function: proxies Vibe Prospecting search requests.
 * This endpoint receives search criteria from the website UI and returns
 * prospect data. In the current version, it stores the search request
 * so Claude Code can process it via the MCP tools, then returns results.
 *
 * POST /api/vibe-prospect
 * Body: { filters, numberOfResults }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Accept filters either as req.body.filters or as req.body directly
  const filters = req.body.filters || req.body;
  const numberOfResults = filters.limit || req.body.numberOfResults || 50;
  if (!filters || Object.keys(filters).length === 0) return res.status(400).json({ error: 'Missing filters' });

  // For now, store the search request in a simple format
  // and return a placeholder response indicating the search was queued.
  // In production, this would call the Vibe Prospecting API directly.

  // Build a summary of what was requested
  const summary = [];
  if (filters.companyName) summary.push(`Company: ${filters.companyName}`);
  if (filters.industry) summary.push(`Industry: ${filters.industry}`);
  if (filters.jobTitle) summary.push(`Title: ${filters.jobTitle}`);
  if (filters.jobDepartments?.length) summary.push(`Depts: ${filters.jobDepartments.join(', ')}`);
  if (filters.jobLevels?.length) summary.push(`Levels: ${filters.jobLevels.join(', ')}`);
  if (filters.companySizes?.length) summary.push(`Size: ${filters.companySizes.join(', ')}`);
  if (filters.companyRevenue?.length) summary.push(`Revenue: ${filters.companyRevenue.join(', ')}`);
  if (filters.country) summary.push(`Country: ${filters.country}`);
  if (filters.hasEmail) summary.push('Has email');

  return res.status(200).json({
    status: 'ready',
    message: `Search configured: ${summary.join(' | ')}. Use Claude Code with Vibe Prospecting to execute this search and push results.`,
    searchCriteria: {
      ...filters,
      numberOfResults,
    },
    // Provide the exact MCP tool call parameters so Claude Code can execute it
    mcpCall: {
      tool: 'fetch-entities',
      params: {
        entity_type: 'prospects',
        number_of_results: numberOfResults,
        filters: {
          ...(filters.jobDepartments?.length ? { job_department: { values: filters.jobDepartments } } : {}),
          ...(filters.jobLevels?.length ? { job_level: { values: filters.jobLevels } } : {}),
          ...(filters.companySizes?.length ? { company_size: { values: filters.companySizes } } : {}),
          ...(filters.companyRevenue?.length ? { company_revenue: { values: filters.companyRevenue } } : {}),
          ...(filters.country ? { company_country_code: { values: [filters.country] } } : {}),
          ...(filters.hasEmail ? { has_email: true } : {}),
        },
        // Note: job_title and linkedin_category need autocomplete first
        // These are provided as hints for the Claude Code operator
        _hints: {
          jobTitleQuery: filters.jobTitle || null,
          industryQuery: filters.industry || null,
          companyNameQuery: filters.companyName || null,
        },
      },
    },
    prospects: [], // Will be populated when Claude Code executes the search
  });
}
