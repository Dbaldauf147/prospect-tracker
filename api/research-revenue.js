// Research a company's annual revenue using Claude with web search.
// Returns a structured JSON object with the headline revenue figure, the
// fiscal year it covers, ownership/ticker, employee count, and citation
// links. Powers the "Research revenue" button on the Corporate
// Compliance page.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'research-revenue', 30, 5 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { company } = req.body || {};
  if (!company || typeof company !== 'string') {
    return res.status(400).json({ error: 'Missing company name' });
  }

  // Web search lets Claude pull the company's most recent public revenue
  // figure (annual report, 10-K, press release, reputable financial
  // sources) rather than relying on training-time knowledge. The
  // structured output prompt asks for a JSON envelope so the card can
  // render a headline figure plus supporting detail and citations.
  const systemPrompt = `You are a financial research analyst. For the requested company, use web search to find its most recent reported annual revenue and closely related facts.

Return ONLY a single JSON object (no prose, no markdown fences) with these fields:
- revenue: string — the headline annual revenue as a readable figure using the company's reporting currency (e.g. "$5.6B", "€1.2B", "$740M"). Empty string if you cannot find a credible figure.
- revenueUsd: number | null — the same figure normalized to whole US dollars (e.g. 5600000000). Null if unknown or not convertible with confidence.
- fiscalYear: string — the fiscal year or period the revenue figure covers (e.g. "FY2023", "2023", "TTM as of Q2 2024"). Empty string if unknown.
- ownership: string — "Public" or "Private" (or "Subsidiary" / "Division" when that's the clearest description). Empty string if unclear.
- ticker: string — stock exchange and ticker if publicly traded (e.g. "NYSE: CNR"). Empty string otherwise.
- employees: number | null — approximate employee count if reported. Null if unknown.
- summary: string — 1-2 sentence plain-language note on the figure: how recent it is, whether it's an estimate, and any caveat (e.g. private company estimates, revenue reported by a parent). Note explicitly when the figure is uncertain or public data is sparse.
- sources: array of { title: string, url: string } — citation list of pages you used, most authoritative first. Up to 6 entries.

Prefer official filings and the company's own investor relations pages over third-party estimators. If the company is private and no credible revenue figure surfaces, return the object with revenue and revenueUsd empty/null and explain in summary.`;

  // The agentic web-search loop (up to 6 sequential searches plus generation)
  // can run long. Abort it a little before the function's own maxDuration so a
  // stuck call returns a clean, retryable error rather than letting Vercel kill
  // the whole invocation with an opaque FUNCTION_INVOCATION_TIMEOUT page.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 290_000);
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
          { role: 'user', content: `Research the most recent annual revenue for "${company}". Return the JSON object as specified.` },
        ],
      }),
      signal: controller.signal,
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

    const asNumOrNull = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const asLinkArray = (v) => Array.isArray(v) ? v
      .filter(o => o && typeof o === 'object' && (o.url || o.href))
      .map(o => ({
        title: String(o.title || o.name || o.url || '').trim(),
        url: String(o.url || o.href || '').trim(),
      }))
      .filter(o => o.url)
      .slice(0, 6) : [];

    return res.status(200).json({
      revenue: String(parsed.revenue || '').trim(),
      revenueUsd: asNumOrNull(parsed.revenueUsd),
      fiscalYear: String(parsed.fiscalYear || '').trim(),
      ownership: String(parsed.ownership || '').trim(),
      ticker: String(parsed.ticker || '').trim(),
      employees: asNumOrNull(parsed.employees),
      summary: String(parsed.summary || '').trim(),
      sources: asLinkArray(parsed.sources),
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'Revenue research timed out. Please try again.' });
    }
    return res.status(500).json({ error: err.message || 'Unknown error' });
  } finally {
    clearTimeout(timeout);
  }
}

export default withAuth(handler);
