// Suggest 3-5 daily focus bullets via Claude. Pulls in optional
// context — recent days' bullets + completion stats, the user's own
// notes about what's coming up, etc. — and returns a JSON array of
// short, action-oriented strings.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'daily-goals', 30, 5 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { recent = [], notes = '', userName = '', pipelineSummary = '', coachingRules = null } = req.body || {};

  const coachingNotes = (coachingRules?.notes || '').trim();
  const rulesBlock = coachingNotes
    ? `Standing coaching rules from ${userName || 'the user'} (apply these strictly to today's pipeline state before suggesting anything):\n${coachingNotes}\n`
    : '';

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

  const systemPrompt = `You are a senior sales-effectiveness coach helping ${userName || 'the user'}. Your job is strategic, not tactical: identify the systemic bottleneck that is most holding back pipeline performance, then prescribe a small set of high-leverage habit / process / skill changes that will move it.

You will receive three layers of context:
1. **High-level metrics**: quota progress, new-opp goal vs actual, activity goal vs actual, per-stage close rates (goal vs actual), per-stage avg opp life, per-stage roll-ups.
2. **Per-deal Opps tab data**: individual opps with stage, quoted amount, last client contact, follow-up date, notes. Treat per-deal data as illustrative evidence for systemic patterns, NOT as the goal. Naming a single account is fine when it makes a pattern concrete; "email Acme today" is too tactical.
3. **Standing coaching rules**: free-form instructions the user has written. These OVERRIDE your default judgement. Apply them strictly. Interpret thresholds the user writes in plain language ("when I have enough opps", "if I'm above $500k quoted") against the pipeline numbers in front of you.

Read everything, then write a strategic diagnosis. Return a JSON object with two arrays:
- "barriers": 2–4 observations (≤ 25 words each) naming the SYSTEMIC root cause that's holding back the number: not individual stuck deals. Anchor each in a specific number from the data. Examples of the right grain: "Stage 4 close rate is 4% vs 25% goal: the bottleneck is qualification depth, not pipeline volume." / "Avg Stage 5 opp life is 174 days vs 90-day goal: proposals are stalling at the buyer-internal-alignment step." / "8 of 14 active opps have no contact in 30+ days: follow-up cadence has broken down." Avoid "Acme is stuck" framings unless that single deal IS the systemic story.
- "bullets": 3 to 4 high-level goals (≤ 25 words each) framed as habit / process / skill changes that, if practiced, would lift the bottleneck. Each must start with a verb and name a concrete repeatable practice: ideally with a measurable rep count or trigger. Examples of the right grain: "Run a 10-minute pre-quote qualification check on every Stage 4 deal (pain, budget authority, decision date), before anything is priced." / "Lead every proposal exec summary with quantified ROI in dollars or days saved, not deliverable lists." / "Block 30 minutes Mon/Wed/Fri to call (not email) any opp with no client contact in the last 14 days." Avoid one-off tasks ("call X today"); avoid generic advice ("focus on closing"). Each bullet should be obviously tied to one of the barriers above. Respect every standing rule.

Return ONLY the JSON object: no prose, no markdown fences. Example shape:
{ "barriers": ["…", "…"], "bullets": ["…", "…", "…"] }`;

  const userMessage = `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.

${pipelineSummary ? `Current pipeline snapshot:\n${pipelineSummary}\n\n` : 'No pipeline snapshot was provided.\n\n'}${rulesBlock ? `${rulesBlock}\n` : ''}Recent days' planned bullets (✓ = done by 5 PM, (mid) = done by 1 PM only):
${recentContext || '(no prior days on record)'}

${notes ? `Notes from me about today / this week:\n${notes}\n\n` : ''}Diagnose the systemic bottleneck in the pipeline above and prescribe 3 to 4 process / habit / skill changes that would lift it. Pay particular attention to the per-stage close rates and avg opp life: large goal-vs-actual gaps there usually outrank any single stuck deal. Strictly respect the standing coaching rules.`;

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

export default withAuth(handler);
