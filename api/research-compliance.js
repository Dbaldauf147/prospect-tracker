// Auto-answer the six corporate-compliance gating questions for a company
// using Claude with web search. Powers the "Research answers" button on the
// Corporate Compliance page: given a company name, returns a Yes/No/Unknown
// verdict per jurisdiction question, a short rationale for each, and
// citation links. The client fills the screening dropdowns from these
// verdicts (the user can still override any answer by hand).
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

// The jurisdiction keys the client persists under, paired with the exact
// question wording so Claude answers the same thing the UI screens for.
// Keep in sync with src/data/corporateComplianceScreening.js.
const QUESTIONS = [
  { key: 'california', question: 'Does the company operate in or sell products or services in California?' },
  { key: 'eu', question: 'Does the company operate in the EU?' },
  { key: 'uk', question: 'Is the company legally incorporated in the UK?' },
  { key: 'australia', question: 'Is the company legally incorporated in Australia?' },
  { key: 'mexico', question: "Does the company issue securities in Mexico, such as through Mexico's stock exchange (e.g. banks, issuers, publicly traded)?" },
  { key: 'brazil', question: "Is the company listed on Brazil's stock exchange?" },
];

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'research-compliance', 30, 5 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { company } = req.body || {};
  if (!company || typeof company !== 'string') {
    return res.status(400).json({ error: 'Missing company name' });
  }

  const questionList = QUESTIONS.map(q => `- "${q.key}": ${q.question}`).join('\n');

  // Web search lets Claude establish where the company operates, where it's
  // incorporated, and where its securities are listed, rather than relying
  // on training-time knowledge. The structured output is a per-question
  // verdict so the card can fill each dropdown and show why.
  const systemPrompt = `You are a corporate-disclosure compliance analyst. For the requested company, use web search to determine the answer to each screening question below. These questions gate which corporate sustainability/financial disclosure regimes may apply (California SB 253/261, EU CSRD, UK, Australia, Mexico CNBV, Brazil CVM).

Questions (answer each by its key):
${questionList}

Be conservative and evidence-based. Answer "Yes" or "No" only when the public record supports it; answer "Unknown" when you cannot find sufficient evidence — do not guess. Consider the whole corporate group (parent and major subsidiaries) when judging where a company operates or is listed, and note in the rationale when a Yes rests on a subsidiary or a parent.

Return ONLY a single JSON object (no prose, no markdown fences) with these fields:
- answers: object mapping each question key to exactly "Yes", "No", or "Unknown".
- notes: object mapping each question key to a one-sentence rationale (plain language; cite the specific fact, e.g. "Incorporated in Delaware; no UK entity found" or "Shares listed on B3 (Brazil) under TICKER"). Keep each under ~200 characters.
- summary: string — 1-2 sentence overview of the company's footprint relevant to these regimes. Empty string if unclear.
- sources: array of { title: string, url: string } — citation list, most authoritative first (official filings / investor relations / exchange listings preferred). Up to 6 entries.

Every question key must appear in both answers and notes.`;

  // The agentic web-search loop can run long; abort a little before the
  // function's maxDuration so a stuck call returns a clean, retryable error
  // rather than an opaque FUNCTION_INVOCATION_TIMEOUT.
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
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
        messages: [
          { role: 'user', content: `Screen "${company}" against the six questions. Return the JSON object as specified.` },
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

    // Normalize each verdict to exactly Yes / No / Unknown, and keep only a
    // short rationale string. Any missing / unexpected value becomes Unknown.
    const normVerdict = (v) => {
      const s = String(v || '').trim().toLowerCase();
      if (s === 'yes') return 'Yes';
      if (s === 'no') return 'No';
      return 'Unknown';
    };
    const answers = {};
    const notes = {};
    for (const q of QUESTIONS) {
      answers[q.key] = normVerdict(parsed.answers?.[q.key]);
      notes[q.key] = String(parsed.notes?.[q.key] || '').trim().slice(0, 300);
    }
    const sources = Array.isArray(parsed.sources) ? parsed.sources
      .filter(o => o && typeof o === 'object' && (o.url || o.href))
      .map(o => ({ title: String(o.title || o.name || o.url || '').trim(), url: String(o.url || o.href || '').trim() }))
      .filter(o => o.url)
      .slice(0, 6) : [];

    return res.status(200).json({
      answers,
      notes,
      summary: String(parsed.summary || '').trim(),
      sources,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'Compliance research timed out. Please try again.' });
    }
    return res.status(500).json({ error: err.message || 'Unknown error' });
  } finally {
    clearTimeout(timeout);
  }
}

export default withAuth(handler);
