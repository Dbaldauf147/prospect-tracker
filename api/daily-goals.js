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

  const systemPrompt = `You are a sharp sales-pipeline coach helping ${userName || 'the user'} pick 3 to 4 high-leverage goals for today, anchored in their actual pipeline state.

Your job:
- Read the pipeline snapshot carefully. Find the highest-leverage moves: late-stage opps without a next step, oldest active opps, gaps to quota, gaps to weekly activity goals, smallest deals dragging average deal size down, etc.
- Suggest 3 to 4 specific goals that could realistically be done in one workday and that move the pipeline forward.
- Reference specific accounts/opportunity names when the data points to them.
- Mix one quick win with one strategic move when possible.
- Avoid generic advice like "stay focused" or "answer email."

Output rules:
- Return ONLY a JSON array of 3 to 4 strings. No prose, no markdown fences.
- Each string is one goal, ≤ 16 words, action-oriented (start with a verb).
- Reference specific opportunity / account names when the snapshot supports it.`;

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
    const match = text.match(/\[[\s\S]*\]/);
    let bullets;
    try {
      bullets = JSON.parse(match ? match[0] : text);
    } catch {
      return res.status(502).json({ error: 'Claude returned malformed JSON', raw: text });
    }
    if (!Array.isArray(bullets)) {
      return res.status(502).json({ error: 'Expected a JSON array of strings', raw: text });
    }

    return res.status(200).json({
      bullets: bullets
        .filter(b => typeof b === 'string')
        .map(b => b.trim().replace(/^[-•*]\s*/, ''))
        .filter(Boolean),
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}
