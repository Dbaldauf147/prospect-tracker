// Suggest 3-5 daily focus bullets via Claude. Pulls in optional
// context — recent days' bullets + completion stats, the user's own
// notes about what's coming up, etc. — and returns a JSON array of
// short, action-oriented strings.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { recent = [], notes = '', userName = '', pipelineSummary = '' } = req.body || {};

  // Build a compact context string from recent entries.
  const recentContext = (recent || [])
    .slice(0, 7)
    .map(d => {
      const lines = (d.bullets || [])
        .map(b => `  - ${b.text}${b.doneEnd ? ' ✓' : b.doneMid ? ' (mid)' : ''}`)
        .join('\n');
      return `${d.date}:\n${lines || '  (none)'}`;
    })
    .join('\n');

  const systemPrompt = `You are a sharp sales-pipeline coach helping ${userName || 'the user'}. Your job has two halves: surface the biggest barriers to success right now, then suggest 3 to 4 high-leverage goals for today that attack those barriers.

You will receive two layers of pipeline context:
1. **High-level metrics** — quota, activity goals, per-stage roll-ups, late-stage opps with no next step.
2. **Per-deal Opps tab data** — individual opportunities with stage, scope, quoted amount, last client contact date, follow-up date, and notes. The Opps tab includes "stuck quotes" (oldest client contact), overdue follow-ups, and top opps by quoted amount.

Read both layers, then return a JSON object with two arrays:
- "barriers": 2–4 short observations (≤ 18 words each) describing the biggest things blocking pipeline progress right now. Reference specific accounts/numbers when possible. Keep them factual and diagnostic — what's wrong / what's stuck / what's missing — not prescriptive.
- "bullets": 3 to 4 specific goals (≤ 16 words each), action-oriented (start with a verb), each one tied to a barrier or to closing a gap. Reference specific accounts/opportunity names where the data supports it. Mix one quick win with one strategic move.

Return ONLY the JSON object — no prose, no markdown fences. Example shape:
{ "barriers": ["…", "…"], "bullets": ["…", "…", "…"] }`;

  const userMessage = `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.

${pipelineSummary ? `Current pipeline snapshot:\n${pipelineSummary}\n\n` : 'No pipeline snapshot was provided.\n\n'}Recent days' planned bullets (✓ = done by 5 PM, (mid) = done by 1 PM only):
${recentContext || '(no prior days on record)'}

${notes ? `Notes from me about today / this week:\n${notes}\n\n` : ''}Suggest 3 to 4 focused goals for today as a JSON array of strings, prioritizing what the pipeline state suggests will move the needle.`;

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
        max_tokens: 512,
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
    // Try to find a JSON object first; fall back to a JSON array
    // (older shape returning bullets only).
    const objMatch = text.match(/\{[\s\S]*\}/);
    const arrMatch = text.match(/\[[\s\S]*\]/);
    let parsed;
    try {
      parsed = JSON.parse(objMatch ? objMatch[0] : (arrMatch ? arrMatch[0] : text));
    } catch {
      return res.status(502).json({ error: 'Claude returned malformed JSON', raw: text });
    }

    const cleanList = (arr) => Array.isArray(arr)
      ? arr.filter(b => typeof b === 'string').map(b => b.trim().replace(/^[-•*]\s*/, '')).filter(Boolean)
      : [];

    if (Array.isArray(parsed)) {
      // Legacy shape: just an array of bullets.
      return res.status(200).json({ barriers: [], bullets: cleanList(parsed) });
    }
    if (parsed && typeof parsed === 'object') {
      return res.status(200).json({
        barriers: cleanList(parsed.barriers),
        bullets: cleanList(parsed.bullets),
      });
    }
    return res.status(502).json({ error: 'Expected JSON object with barriers/bullets', raw: text });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}
