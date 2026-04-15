// Research a private equity firm's portfolio companies using Claude.
// Returns a structured array of { companyName, industry, hqCity, hqCountry, energyGwh, siteCount, pcDescription, acquisitionYear }.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { company } = req.body || {};
  if (!company || typeof company !== 'string') {
    return res.status(400).json({ error: 'Missing company name' });
  }

  const systemPrompt = `You are a research assistant that identifies private equity portfolio companies and estimates their annual energy consumption.

For the given firm, return ONLY a JSON array (no prose, no markdown fences) of their CURRENT portfolio companies. Each object must have exactly these fields:
- companyName: string
- industry: one of "Technology", "Industrials", "Healthcare", "Consumer", "Financials", "Media & Telecom", "Real Estate", "Energy", "Materials", or "Other"
- hqCity: string (include state abbreviation for USA, e.g. "Dallas, TX")
- hqCountry: string (e.g. "USA", "UK", "France")
- energyGwh: number — an ESTIMATED annual electricity consumption in GWh/year based on the company's industry, scale, and operations. Use industry benchmarks (manufacturing = high, software = low). These are approximations.
- siteCount: number — an ESTIMATED count of physical operating sites/facilities (offices, plants, warehouses, stores, data centers). Use best available public info or a reasonable industry estimate.
- pcDescription: string — a short (1-2 sentence) description of what the company does.
- acquisitionYear: number — the four-digit year the firm acquired this portfolio company (omit if unknown).

Return up to 100 companies. If unsure about a field, use your best estimate. Do not wrap in any object — return a bare JSON array.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          { role: 'user', content: `Research the current portfolio companies of "${company}" and return the JSON array as specified.` },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Claude API error: ${errText}` });
    }

    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

    // Extract JSON array from the response
    let jsonText = text;
    const match = text.match(/\[[\s\S]*\]/);
    if (match) jsonText = match[0];

    let companies;
    try {
      companies = JSON.parse(jsonText);
    } catch (err) {
      return res.status(502).json({ error: 'Claude returned malformed JSON', raw: text });
    }

    if (!Array.isArray(companies)) {
      return res.status(502).json({ error: 'Expected JSON array', raw: text });
    }

    // Normalize each entry
    const cleaned = companies
      .filter(c => c && typeof c === 'object' && c.companyName)
      .map(c => ({
        companyName: String(c.companyName || '').trim(),
        industry: String(c.industry || '').trim(),
        hqCity: String(c.hqCity || '').trim(),
        hqCountry: String(c.hqCountry || '').trim(),
        energyGwh: c.energyGwh == null ? '' : String(c.energyGwh),
        siteCount: c.siteCount == null ? '' : String(c.siteCount),
        pcDescription: c.pcDescription == null ? '' : String(c.pcDescription).trim(),
        acquisitionYear: c.acquisitionYear == null ? '' : String(c.acquisitionYear).trim(),
      }));

    return res.status(200).json({ companies: cleaned, count: cleaned.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
