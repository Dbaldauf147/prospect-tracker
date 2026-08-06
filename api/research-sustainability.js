// Research a company's sustainability program using Claude with web search.
// Returns a structured JSON object summarizing programs, targets, frameworks,
// and links to public ESG reports / sustainability disclosures.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'research-sustainability', 30, 5 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { company } = req.body || {};
  if (!company || typeof company !== 'string') {
    return res.status(400).json({ error: 'Missing company name' });
  }

  // Web search lets Claude pull the company's most recent sustainability
  // disclosures rather than relying on its training-time knowledge. The
  // structured output prompt asks for a JSON envelope so the modal can
  // render distinct sections (programs / targets / frameworks / reports).
  const systemPrompt = `You are a sustainability research analyst. For the requested company, use web search to identify their public sustainability program, climate targets, ESG disclosures, and reporting frameworks they participate in.

Return ONLY a single JSON object (no prose, no markdown fences) with these fields:
- summary: string: 2-3 sentence executive overview of the company's sustainability stance. Note explicitly when public information is sparse.
- programs: array of strings: bullet-style descriptions of major sustainability initiatives or programs (e.g. "renewable energy procurement via PPA", "Scope 3 supplier engagement", "operational efficiency program").
- targets: array of strings: concrete quantified commitments where available, each as a single line (e.g. "Net zero across all scopes by 2050", "50% absolute Scope 1+2 reduction by 2030 vs 2019 baseline", "100% renewable electricity by 2025"). Use the company's own language where possible.
- frameworks: array of strings: only labels they have publicly disclosed or committed to, drawn from: "RECA", "CSRD", "IFRS", "TCFD", "CDP", "GRESB", "SBT", "Ecovadis", "UN PRI", "CA SB", "NZAM". Use this exact spelling. Omit any framework you don't have direct evidence for. Use "IFRS" for the IFRS Sustainability Disclosure Standards (ISSB S1 / S2) and "TCFD" for a TCFD-aligned disclosure — for these two, report them only when the company has actually published a report under them.
- reports: array of { title: string, url: string, year: number? }: links to public ESG / sustainability reports or pages found via web search. Prefer the most recent. Up to 5 entries.
- sources: array of { title: string, url: string }: citation list of pages you used to derive the above. Up to 8 entries.

If no public sustainability information surfaces, return the JSON object with summary explaining that and the other arrays empty.`;

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
        max_tokens: 4096,
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
        messages: [
          { role: 'user', content: `Research the sustainability program, targets, ESG disclosures, and reporting frameworks for "${company}". Return the JSON object as specified.` },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Claude API error: ${errText}` });
    }

    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

    let jsonText = text;
    const match = text.match(/\{[\s\S]*\}/);
    if (match) jsonText = match[0];

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return res.status(502).json({ error: 'Claude returned malformed JSON', raw: text });
    }

    const ALLOWED_FRAMEWORKS = new Set(['RECA', 'CSRD', 'IFRS', 'TCFD', 'CDP', 'GRESB', 'SBT', 'Ecovadis', 'UN PRI', 'CA SB', 'NZAM']);
    const asStrArray = (v) => Array.isArray(v) ? v.map(x => String(x || '').trim()).filter(Boolean) : [];
    const asLinkArray = (v) => Array.isArray(v) ? v
      .filter(o => o && typeof o === 'object' && (o.url || o.href))
      .map(o => ({
        title: String(o.title || o.name || o.url || '').trim(),
        url: String(o.url || o.href || '').trim(),
        ...(o.year != null && { year: Number(o.year) || undefined }),
      }))
      .filter(o => o.url) : [];

    return res.status(200).json({
      summary: String(parsed.summary || '').trim(),
      programs: asStrArray(parsed.programs),
      targets: asStrArray(parsed.targets),
      frameworks: asStrArray(parsed.frameworks).filter(f => ALLOWED_FRAMEWORKS.has(f)),
      reports: asLinkArray(parsed.reports),
      sources: asLinkArray(parsed.sources),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

export default withAuth(handler);
