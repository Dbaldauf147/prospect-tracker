// Rank a list of user-defined goals against the live pipeline state +
// standing coaching rules, and produce 3-6 concrete daily tasks tied
// to the top goals so the user can drop them straight into their
// Daily Success Log bullets.

function formatAnthropicError(status, body) {
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  const inner = parsed && parsed.error;
  const message = inner && typeof inner.message === 'string' ? inner.message : '';
  const type = inner && typeof inner.type === 'string' ? inner.type : '';
  if (/credit balance is too low/i.test(message)) {
    return 'Anthropic API credits are exhausted. Add credits at console.anthropic.com → Plans & Billing, then retry.';
  }
  if (status === 401 || type === 'authentication_error') {
    return 'Anthropic API key is invalid or missing. Check the ANTHROPIC_API_KEY environment variable.';
  }
  if (status === 429 || type === 'rate_limit_error') {
    return 'Anthropic rate limit hit. Wait a moment and retry.';
  }
  if (status === 529 || type === 'overloaded_error') {
    return 'Anthropic API is temporarily overloaded. Retry in a few seconds.';
  }
  if (message) return `Claude API error: ${message}`;
  return `Claude API error (${status}): ${body}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const {
    goals = [],
    pipelineSummary = '',
    coachingRules = null,
    userName = '',
  } = req.body || {};

  const cleanGoals = (goals || [])
    .filter(g => g && typeof g.id === 'string' && typeof g.text === 'string' && g.text.trim().length > 0)
    .map(g => ({ id: g.id, text: g.text.trim() }));

  if (cleanGoals.length === 0) {
    return res.status(400).json({ error: 'No goals provided' });
  }

  const goalsBlock = cleanGoals
    .map((g, i) => `${i + 1}. [${g.id}] ${g.text}`)
    .join('\n');

  const coachingNotes = (coachingRules?.notes || '').trim();
  const rulesBlock = coachingNotes
    ? `Standing coaching rules from ${userName || 'the user'} (apply these strictly):\n${coachingNotes}\n`
    : '';

  const systemPrompt = `You are a senior sales-effectiveness coach helping ${userName || 'the user'} translate long-running goals into daily action.

You receive:
1. A list of goals the user wants to make progress on. Each goal is identified by an opaque id in square brackets — when you reference goals back, use those exact ids.
2. A pipeline snapshot: quota progress, stage counts, close-rate gaps, per-deal opportunities with stage / quoted amount / next steps. Some goals will be more leveraged against the current pipeline than others — your job is to surface that.
3. (Optional) Standing coaching rules — free-form instructions the user has written. These OVERRIDE your default judgement.

Return a JSON object with two arrays:

- "prioritized": every goal id, ordered by priority (most leveraged first). Each entry shape: { "id": "<goal id>", "priority": <integer starting at 1>, "rationale": "<≤30 words explaining why this rank, anchored to a number from the pipeline>" }. EVERY input goal must appear exactly once. Priority numbers must be unique and contiguous (1, 2, 3, …).

- "dailyTasks": 3 to 6 concrete actions the user could take today that would advance the highest-priority goals. Each entry shape: { "goalId": "<goal id>", "text": "<≤25 words, action-oriented, starts with a verb>" }. Tasks should be specific enough to act on without further planning ("Call Acme decision maker to schedule a discovery for next week") but not so micro that one would only take 5 minutes. Concentrate tasks on the top 1-2 goals; don't spread thin across every goal. Respect coaching rules.

Return ONLY the JSON object — no prose, no markdown fences. Example shape:
{ "prioritized": [{ "id": "g_abc", "priority": 1, "rationale": "…" }], "dailyTasks": [{ "goalId": "g_abc", "text": "…" }] }`;

  const userMessage = `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.

${pipelineSummary ? `Current pipeline snapshot:\n${pipelineSummary}\n\n` : 'No pipeline snapshot was provided.\n\n'}${rulesBlock ? `${rulesBlock}\n` : ''}Goals to prioritize and turn into today's actions:
${goalsBlock}

Rank every goal by leverage against the pipeline state above and produce 3-6 concrete daily tasks for the top goals. Strictly respect any standing coaching rules.`;

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
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: formatAnthropicError(resp.status, errText) });
    }

    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const objMatch = text.match(/\{[\s\S]*\}/);
    let parsed;
    try {
      parsed = JSON.parse(objMatch ? objMatch[0] : text);
    } catch {
      return res.status(502).json({ error: 'Claude returned malformed JSON', raw: text });
    }

    const validIds = new Set(cleanGoals.map(g => g.id));
    const prioritized = Array.isArray(parsed?.prioritized)
      ? parsed.prioritized
          .filter(p => p && validIds.has(p.id))
          .map(p => ({
            id: String(p.id),
            priority: Number.isFinite(p.priority) ? Number(p.priority) : null,
            rationale: typeof p.rationale === 'string' ? p.rationale.trim() : '',
          }))
      : [];
    const dailyTasks = Array.isArray(parsed?.dailyTasks)
      ? parsed.dailyTasks
          .filter(t => t && typeof t.text === 'string' && t.text.trim().length > 0)
          .map(t => ({
            goalId: validIds.has(t.goalId) ? String(t.goalId) : null,
            text: t.text.trim().replace(/^[-•*]\s*/, ''),
          }))
      : [];

    return res.status(200).json({ prioritized, dailyTasks });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}
