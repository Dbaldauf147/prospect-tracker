// Weekly review — reads the deterministic snapshot of the YOY, Pipeline and
// Progress chart data and asks Claude what's holding the user back from
// hitting their annual target.
//
// Every number is computed client-side (src/utils/weeklyReview.js); the model
// only interprets them. The response is constrained to a JSON schema so the
// client can render and store it as structured rows rather than parsing prose.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

// Structured-output schema. Every object sets additionalProperties:false and
// lists all properties in `required`, which the API requires for a strict
// schema. Count limits (3–5 blockers) are prompted rather than schema'd —
// minItems/maxItems aren't supported constraints.
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'One sentence: the single most important thing standing between this person and their target right now.',
    },
    targetOutlook: {
      type: 'string',
      description: 'Two or three sentences on where the year lands if nothing changes, grounded in the pace, gap, and pipeline numbers.',
    },
    blockers: {
      type: 'array',
      description: 'The 3-5 things most holding the person back, most consequential first.',
      items: {
        type: 'object',
        properties: {
          area: {
            type: 'string',
            enum: ['YOY', 'Pipeline', 'Progress'],
            description: 'Which chart tab the evidence for this blocker comes from.',
          },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string', description: 'Short label, under ~8 words.' },
          evidence: {
            type: 'string',
            description: 'The specific numbers from the stats block that show this, quoted exactly.',
          },
          impact: {
            type: 'string',
            description: 'What this costs in dollars or deals against the target, using the numbers given.',
          },
          action: {
            type: 'string',
            description: 'One concrete, doable-this-week action that addresses it.',
          },
        },
        required: ['area', 'severity', 'title', 'evidence', 'impact', 'action'],
        additionalProperties: false,
      },
    },
    working: {
      type: 'array',
      description: '1-3 things the numbers show are genuinely working and worth protecting.',
      items: { type: 'string' },
    },
    focus: {
      type: 'array',
      description: '2-3 specific things to do next week, ordered by expected impact on the target.',
      items: { type: 'string' },
    },
  },
  required: ['headline', 'targetOutlook', 'blockers', 'working', 'focus'],
  additionalProperties: false,
};

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Weekly cadence with room for manual re-runs and a few retries.
  if (!(await enforceRateLimit(res, auth.uid, 'weekly-review', 20, 60 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const {
    stats = '',
    weekLabel = '',
    userName = '',
    coachingRules = null,
    priorReviews = [],
  } = req.body || {};

  if (!stats || !String(stats).trim()) {
    return res.status(400).json({ error: 'Missing stats block' });
  }

  const coachingNotes = (coachingRules?.notes || '').trim();
  const rulesBlock = coachingNotes
    ? `Standing context from ${userName || 'the user'} (use it to frame what matters):\n${coachingNotes}\n\n`
    : '';

  // Prior weeks' headlines + blocker titles, so the review can say what has
  // and hasn't moved rather than repeating itself every week.
  const historyBlock = Array.isArray(priorReviews) && priorReviews.length
    ? `Previous weeks' reviews (most recent first) — call out what has moved and what keeps recurring:\n${
      priorReviews.slice(0, 6).map(p => {
        const titles = Array.isArray(p?.blockers) ? p.blockers.map(b => b?.title).filter(Boolean).join('; ') : '';
        return `- ${p?.week || '?'}: ${p?.headline || '(no headline)'}${titles ? ` | blockers: ${titles}` : ''}`;
      }).join('\n')
    }\n\n`
    : '';

  const systemPrompt = `You are a sales-effectiveness coach doing a weekly review for ${userName || 'a salesperson'} who sells energy and sustainability services to enterprise accounts.

You are given a deterministic stats block computed from their own tracker, covering three views:
- YOY: sold dollars by year, close rates, average deal size, lead volume, and this year's pace against the annual target.
- PIPELINE: the stage-by-stage metrics table — goal vs actual for active opportunity count, deal size, pipeline dollars, close rate, and average opportunity age, plus coverage ratio, client mix, not-quoted rate, and activity counts.
- PROGRESS: weekly account-coverage snapshots (contacts, decision makers, connected accounts, inactive accounts, PE stages) with week-over-week and four-week changes.

Your job is to identify what is holding this person back from hitting their annual target, and to be specific and honest about it.

How to think about it:
- Start from the gap. The target, the amount closed, the pace, and the run-rate projection are given — reason from those.
- Find the binding constraint. A funnel fails at a specific point: not enough opportunities entering, deals too small, conversion too low, deals aging out, or coverage too thin to survive normal loss rates. Use the goal-vs-actual columns and the target projection to locate it rather than listing everything that looks imperfect.
- Connect leading to lagging indicators. Progress-tab coverage gaps (no decision maker, no contacts, accounts with no opportunities) are usually the upstream cause of a thin pipeline eight to twelve weeks later — say so when the numbers support it.
- Quantify. When you can express a blocker in dollars or deals against the target using the numbers given, do it.
- Distinguish a genuine problem from noise. A single week's move in one percentage point is not a trend; a four-week direction is.

Rules:
- Use only numbers present in the stats block. Never invent, extrapolate beyond what is stated, or infer figures that aren't given.
- If a section is missing from the stats block, say what you cannot assess rather than guessing — do not treat missing data as zero.
- Be direct. Lead with the constraint, not with encouragement. Skip preamble and flattery.
- Every blocker needs a concrete action that can start this week.
- Return 3-5 blockers, most consequential first.`;

  const userMessage = `Weekly review for ${weekLabel || 'this week'}.

${rulesBlock}${historyBlock}Computed stats:
${String(stats).trim()}

Identify what is holding this person back from hitting their target.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 16000,
        system: systemPrompt,
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: REVIEW_SCHEMA },
        },
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Claude API error: ${errText}` });
    }

    const data = await resp.json();

    // A safety refusal comes back as a normal 200 with empty/partial content —
    // check the stop reason before reading the blocks.
    if (data.stop_reason === 'refusal') {
      return res.status(502).json({ error: 'Claude declined to write this review.' });
    }
    if (data.stop_reason === 'max_tokens') {
      return res.status(502).json({ error: 'Review was cut off before it finished — try again.' });
    }

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) {
      return res.status(502).json({ error: 'Claude returned an empty review' });
    }

    let review;
    try {
      review = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: 'Claude returned a malformed review' });
    }
    if (!review || !Array.isArray(review.blockers)) {
      return res.status(502).json({ error: 'Review was missing its blockers' });
    }

    return res.status(200).json({ review });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export default withAuth(handler);
