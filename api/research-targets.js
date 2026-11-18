// Research the climate targets a company has set, using Claude with web
// search, and return them as rows shaped like the company popup's Targets
// table. Powers the Targets tab's "Research targets" button. The prompt and
// the cleaning of the answer live in _lib/researchTargets.js.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { researchBudgetMs } from './_lib/researchBudget.js';
import { allowedTypes, buildSystemPrompt, buildUserPrompt, cleanResearchedTargets } from './_lib/researchTargets.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'research-targets', 30, 5 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { company, domain, types } = req.body || {};
  if (!company || typeof company !== 'string') {
    return res.status(400).json({ error: 'Missing company name' });
  }
  const cleanDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(domain || '')) ? String(domain).toLowerCase() : '';
  const typeList = allowedTypes(types);

  // Abort inside the deployment's own function limit: see researchBudget.js.
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
        // Same model and search tool as the other research buttons
        // (research-revenue, research-sustainability), which are known to
        // finish inside the function limit.
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        system: buildSystemPrompt(typeList),
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [
          { role: 'user', content: buildUserPrompt({ company: company.slice(0, 200), domain: cleanDomain }) },
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
    const match = text.match(/\{[\s\S]*\}/);

    let parsed;
    try {
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      return res.status(502).json({ error: 'Claude returned malformed JSON. Try again.', raw: text.slice(0, 2000) });
    }

    return res.status(200).json(cleanResearchedTargets(parsed, typeList));
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({
        error: `Target research timed out after ${Math.round(researchBudgetMs() / 1000)}s. Try again: if it keeps timing out, raise RESEARCH_TIMEOUT_MS (needs a plan whose function limit allows it).`,
      });
    }
    return res.status(500).json({ error: err.message || 'Unknown error' });
  } finally {
    clearTimeout(timeout);
  }
}

export default withAuth(handler);
