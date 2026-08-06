// Research a company's annual revenue using Claude with web search.
// Returns a structured JSON object with the headline revenue figure, the
// fiscal year it covers, ownership/ticker, employee count, headquarters
// (and whether it sits in North America), and citation links. Powers the
// "Research revenue" button on the Corporate Compliance page.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { researchBudgetMs } from './_lib/researchBudget.js';

// The company popup stores HQ Region as one of exactly these two values.
const HQ_REGIONS = new Set(['North America', 'Outside of North America']);

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
- revenue: string: the headline annual revenue as a readable figure using the company's reporting currency (e.g. "$5.6B", "€1.2B", "$740M"). Empty string if you cannot find a credible figure.
- revenueUsd: number | null: the same figure normalized to whole US dollars (e.g. 5600000000). Null if unknown or not convertible with confidence.
- fiscalYear: string: the fiscal year or period the revenue figure covers (e.g. "FY2023", "2023", "TTM as of Q2 2024"). Empty string if unknown.
- ownership: string: "Public" or "Private" (or "Subsidiary" / "Division" when that's the clearest description). Empty string if unclear.
- ticker: string: stock exchange and ticker if publicly traded (e.g. "NYSE: CNR"). Empty string otherwise.
- employees: number | null: approximate employee count if reported. Null if unknown.
- parentCompany: string: the company's ULTIMATE parent — the top entity of the consolidated group it reports into, not an intermediate holding company. Empty string when the company IS its own ultimate parent (no owner above it), which is the common case, or when ownership is genuinely unclear. Name the parent exactly as it is commonly written (e.g. "Brookfield Corporation", "MassMutual"). For a company owned by a private-equity or asset-management firm, name that firm. Never repeat the requested company's own name here.
- headquarters: string: the company's global headquarters as "City, State/Province, Country" (e.g. "Toronto, Ontario, Canada", "Zug, Switzerland"). Always name the country. Empty string if you cannot find it.
- hqRegion: string: exactly "North America" when that headquarters is in the United States, Canada or Mexico, otherwise exactly "Outside of North America". Empty string if the headquarters is unknown.
- summary: string: 1-2 sentence plain-language note on the figure: how recent it is, whether it's an estimate, and any caveat (e.g. private company estimates, revenue reported by a parent). Note explicitly when the figure is uncertain or public data is sparse, and when a parent is named, say briefly how the ownership was established.
- sources: array of { title: string, url: string }: citation list of pages you used, most authoritative first. Up to 6 entries.

Prefer official filings and the company's own investor relations pages over third-party estimators. If the company is private and no credible revenue figure surfaces, return the object with revenue and revenueUsd empty/null and explain in summary.`;

  // The agentic web-search loop (sequential searches plus generation) can run
  // long, so abort inside the deployment's own function limit — see
  // researchBudget.js for why that limit, not vercel.json's maxDuration, is
  // what has to be beaten.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), researchBudgetMs());
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
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
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

    // Loose name equality for the self-as-parent check: punctuation, case
    // and the usual corporate suffixes differ between how a company is
    // filed here and how the model writes it back.
    const bareName = (v) => String(v || '')
      .toLowerCase()
      .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|holdings|holding|group)\b\.?/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const sameCompany = (a, b) => {
      const x = bareName(a);
      const y = bareName(b);
      return !!x && x === y;
    };
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
      // A parent echoing the requested company back is the model saying
      // "it is its own parent" the long way round; blank it so the client
      // doesn't file a company as its own owner and screen it twice.
      parentCompany: sameCompany(parsed.parentCompany, company) ? '' : String(parsed.parentCompany || '').trim(),
      headquarters: String(parsed.headquarters || '').trim(),
      // Only the two values the company popup's HQ Region dropdown offers —
      // anything else is dropped so the client never persists a value that
      // can't render in that select.
      hqRegion: HQ_REGIONS.has(String(parsed.hqRegion || '').trim())
        ? String(parsed.hqRegion).trim() : '',
      summary: String(parsed.summary || '').trim(),
      sources: asLinkArray(parsed.sources),
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({
        error: `Revenue research timed out after ${Math.round(researchBudgetMs() / 1000)}s. Try again: if it keeps timing out, raise RESEARCH_TIMEOUT_MS (needs a plan whose function limit allows it).`,
      });
    }
    return res.status(500).json({ error: err.message || 'Unknown error' });
  } finally {
    clearTimeout(timeout);
  }
}

export default withAuth(handler);
