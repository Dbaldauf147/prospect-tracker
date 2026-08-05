// Write a short end-of-week (or end-of-day) work-summary narrative via
// Claude. The client sends a deterministic plain-text stats block (built
// from the HubSpot activity cache + Opps 2 field-change timestamps +
// goals), plus optional pipeline context and coaching rules; Claude turns
// it into a crisp recap the user can read or forward. The hard numbers
// are computed client-side — the LLM only writes the prose over them.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'week-report', 30, 5 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const {
    stats = '',
    periodLabel = '',
    scope = 'week',
    userName = '',
    pipelineSummary = '',
    coachingRules = null,
  } = req.body || {};

  if (!stats || !String(stats).trim()) {
    return res.status(400).json({ error: 'Missing stats block' });
  }

  const coachingNotes = (coachingRules?.notes || '').trim();
  const rulesBlock = coachingNotes
    ? `Standing context from ${userName || 'the user'} (use to frame what mattered):\n${coachingNotes}\n\n`
    : '';

  const periodWord = scope === 'day' ? 'day' : 'week';

  const systemPrompt = `You are a sales-effectiveness coach writing a concise ${periodWord}-in-review recap for ${userName || 'a salesperson'}. You are given a deterministic stats block already computed from their tool: outreach activity (emails, calls, meetings), opportunity changes (new opps, deals closed, stage changes, close-date moves, amount updates, BFO opportunity tags), and goals.

Write a tight, upbeat-but-honest recap in this exact structure, using Markdown:

## Summary
One or two sentences capturing the headline of the ${periodWord}: lead with the most consequential outcome (deals closed and their value if any, otherwise the strongest activity or pipeline movement).

## Highlights
3–5 bullet points of what actually got done, each anchored in a real number from the stats. Name specific accounts when the stats list them and it makes the point concrete. Do not invent numbers or accounts: use only what is in the stats block.

## Where the effort went
1–2 sentences on the shape of the work (prospecting vs. advancing vs. closing) based on the mix of activity and opp changes.

## Watch next ${periodWord}
2–3 forward-looking bullets: momentum to keep, or gaps implied by the numbers (e.g. lots of outreach but no stage movement, or open goals with no progress). Keep these grounded in the data, not generic advice.

Rules: Never fabricate figures, accounts, or outcomes not present in the stats. If a section has no data (e.g. zero deals closed), say so plainly and move on: do not pad. Keep the whole thing under ~250 words. Return only the Markdown recap, no preamble.`;

  const userMessage = `This is the end-of-${periodWord} recap for ${periodLabel || 'the current ' + periodWord}.

${rulesBlock}Computed stats for the period:
${String(stats).trim()}

${pipelineSummary && pipelineSummary.trim() ? `Broader pipeline context (for framing, may span longer than this ${periodWord}):\n${pipelineSummary.trim()}\n\n` : ''}Write the recap now.`;

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
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Claude API error: ${errText}` });
    }

    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) {
      return res.status(502).json({ error: 'Claude returned an empty recap' });
    }
    return res.status(200).json({ narrative: text });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export default withAuth(handler);
