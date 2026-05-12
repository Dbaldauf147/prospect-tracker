// Research a company's sustainability program using Claude with web search.
// Returns a structured JSON object summarizing programs, targets, frameworks,
// and links to public ESG reports / sustainability disclosures.

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

  // Tight system prompt — every token here is billed against the
  // org-wide input-tokens-per-minute budget and gets re-sent on every
  // web-search round trip, so we trim hard.
  const FRAMEWORK_LABELS = '"RECA","CSRD","CDP","GRESB","SBT","Ecovadis","UN PRI","CA SB","NZAM"';
  const systemPrompt = `You are a sustainability research analyst. For the company you're asked about, use web search to find their public sustainability program, climate targets, ESG disclosures, and reporting frameworks. Be efficient — 2-3 high-signal searches.

Return ONLY a single JSON object (no prose, no markdown fences):
- summary: 2-3 sentence overview. Say so explicitly if public info is sparse.
- programs: array of short bullet strings — major sustainability initiatives.
- targets: array of strings — concrete quantified commitments, one per line, in the company's own language where possible.
- frameworks: array of labels strictly from this list (exact spelling): ${FRAMEWORK_LABELS}. Omit any without direct evidence.
- reports: array of { title, url, year? } — up to 5 public ESG / sustainability reports.
- sources: array of { title, url } — up to 8 citations.

If no public sustainability info surfaces, return the object with summary explaining that and the other arrays empty.`;

  // Retry once on HTTP 429 (rate limit). The Anthropic API returns a
  // retry-after header in seconds; clamp it so we don't blow the
  // serverless function's timeout budget. After that we surface a
  // friendly error to the client so they can re-click later.
  async function callClaude() {
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        system: systemPrompt,
        // Cap web-search rounds — each search result is re-sent as
        // input on the next turn and chews through the ITPM budget
        // fast. Two rounds is usually enough for a sustainability
        // overview.
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
        messages: [
          { role: 'user', content: `Research the sustainability program, targets, ESG disclosures, and reporting frameworks for "${company}". Return the JSON object as specified.` },
        ],
      }),
    });
  }

  try {
    let resp = await callClaude();
    if (resp.status === 429) {
      const retryAfterRaw = Number(resp.headers.get('retry-after') || '0');
      const waitSec = Math.min(Math.max(retryAfterRaw || 8, 4), 12);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      resp = await callClaude();
    }

    if (!resp.ok) {
      const errText = await resp.text();
      // Parse the Anthropic error envelope so the UI gets a clean
      // one-line message instead of the raw JSON dump.
      let friendly = errText;
      let retryAfter = null;
      try {
        const parsed = JSON.parse(errText);
        friendly = parsed?.error?.message || friendly;
      } catch {}
      if (resp.status === 429) {
        const headerRetry = Number(resp.headers.get('retry-after') || '0');
        if (headerRetry > 0) retryAfter = headerRetry;
        friendly = `Anthropic rate limit hit${retryAfter ? ` — try again in ~${retryAfter}s` : ' — try again in a minute'}.`;
      }
      return res.status(resp.status).json({ error: friendly, retryAfter });
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

    const ALLOWED_FRAMEWORKS = new Set(['RECA', 'CSRD', 'CDP', 'GRESB', 'SBT', 'Ecovadis', 'UN PRI', 'CA SB', 'NZAM']);
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
