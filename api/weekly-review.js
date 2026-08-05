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

// Give up a little before the platform would kill the function (vercel.json
// puts api/*.js at 300s), so an overrun comes back as a readable message
// instead of an opaque gateway 504.
const DEADLINE_MS = 240 * 1000;
const KEEPALIVE_MS = 10 * 1000;

// Commit the response as a 200 and start trickling bytes so nothing in the
// path treats a multi-minute generation as a dead connection.
//
// The padding is spaces, which is legal leading whitespace in JSON — the
// caller's resp.json() parses the final object exactly as it did when this
// endpoint buffered. Returns the writer that ends the response; after calling
// openKeepAlive every exit path must go through it, since the status line is
// already on the wire and errors have to travel in the body.
function openKeepAlive(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(' ');

  const timer = setInterval(() => {
    try { res.write(' '); } catch { /* client hung up; the end below is a no-op */ }
  }, KEEPALIVE_MS);
  if (timer.unref) timer.unref();

  return function send(payload) {
    clearInterval(timer);
    res.end(JSON.stringify(payload));
    return undefined;
  };
}

// Anthropic's SSE stream as parsed event objects. Events are separated by a
// blank line; we only care about the `data:` payloads, and `[DONE]`-style
// sentinels aren't JSON so they're skipped.
async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          try { yield JSON.parse(raw); } catch { /* partial or non-JSON frame */ }
        }
      }
    }
  } finally {
    // Bailing out early (an `error` frame) leaves the upstream socket open
    // otherwise, and the function can outlive the response.
    await reader.cancel().catch(() => {});
  }
}

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
    ? `Previous weeks' reviews (most recent first): call out what has moved and what keeps recurring:\n${
      priorReviews.slice(0, 6).map(p => {
        const titles = Array.isArray(p?.blockers) ? p.blockers.map(b => b?.title).filter(Boolean).join('; ') : '';
        return `- ${p?.week || '?'}: ${p?.headline || '(no headline)'}${titles ? ` | blockers: ${titles}` : ''}`;
      }).join('\n')
    }\n\n`
    : '';

  const systemPrompt = `You are a sales-effectiveness coach doing a weekly review for ${userName || 'a salesperson'} who sells energy and sustainability services to enterprise accounts.

You are given a deterministic stats block computed from their own tracker, covering three views:
- YOY: sold dollars by year, close rates, average deal size, lead volume, and this year's pace against the annual target.
- PIPELINE: the stage-by-stage metrics table: goal vs actual for active opportunity count, deal size, pipeline dollars, close rate, and average opportunity age, plus coverage ratio, client mix, not-quoted rate, and activity counts.
- PROGRESS: weekly account-coverage snapshots (contacts, decision makers, connected accounts, inactive accounts, PE stages) with week-over-week and four-week changes.

Your job is to identify what is holding this person back from hitting their annual target, and to be specific and honest about it.

How to think about it:
- Start from the gap. The target, the amount closed, the pace, and the run-rate projection are given: reason from those.
- Find the binding constraint. A funnel fails at a specific point: not enough opportunities entering, deals too small, conversion too low, deals aging out, or coverage too thin to survive normal loss rates. Use the goal-vs-actual columns and the target projection to locate it rather than listing everything that looks imperfect.
- Connect leading to lagging indicators. Progress-tab coverage gaps (no decision maker, no contacts, accounts with no opportunities) are usually the upstream cause of a thin pipeline eight to twelve weeks later: say so when the numbers support it.
- Quantify. When you can express a blocker in dollars or deals against the target using the numbers given, do it.
- Distinguish a genuine problem from noise. A single week's move in one percentage point is not a trend; a four-week direction is.

Rules:
- Use only numbers present in the stats block. Never invent, extrapolate beyond what is stated, or infer figures that aren't given.
- If a section is missing from the stats block, say what you cannot assess rather than guessing: do not treat missing data as zero.
- Be direct. Lead with the constraint, not with encouragement. Skip preamble and flattery.
- Every blocker needs a concrete action that can start this week.
- Return 3-5 blockers, most consequential first.`;

  const userMessage = `Weekly review for ${weekLabel || 'this week'}.

${rulesBlock}${historyBlock}Computed stats:
${String(stats).trim()}

Identify what is holding this person back from hitting their target.`;

  // High-effort review on a big stats block runs for minutes. A buffered
  // request that long dies twice over: the model call can outlive Anthropic's
  // non-streaming ceiling, and a connection that sends nothing for minutes gets
  // dropped by whatever sits between the browser and the function — which is
  // what surfaced as HTTP 504. So: stream from Claude, and stream to the
  // caller (see keepAlive below).
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), DEADLINE_MS);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 16000,
        stream: true,
        system: systemPrompt,
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: REVIEW_SCHEMA },
        },
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    // Streaming means the status arrives before any generation happens, so a
    // rejected request still gets a real status code — nothing is written to
    // the caller until we know Claude accepted it.
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      clearTimeout(deadline);
      return res.status(resp.status).json({ error: `Claude API error: ${errText}` });
    }

    // From here the response is committed as 200 and errors travel in the
    // body, because keepAlive has already started writing.
    const send = openKeepAlive(res);

    let text = '';
    let stopReason = null;
    try {
      for await (const event of sseEvents(resp.body)) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          text += event.delta.text || '';
        } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason;
        } else if (event.type === 'error') {
          return send({ error: `Claude API error: ${event.error?.message || 'stream failed'}` });
        }
      }
    } catch (err) {
      return send({
        error: controller.signal.aborted
          ? 'The review took too long to generate: try again.'
          : `Claude stream failed: ${err?.message || err}`,
      });
    }

    // A safety refusal comes back as a normal stream with empty/partial
    // content — check the stop reason before reading the text.
    if (stopReason === 'refusal') {
      return send({ error: 'Claude declined to write this review.' });
    }
    if (stopReason === 'max_tokens') {
      return send({ error: 'Review was cut off before it finished: try again.' });
    }

    text = text.trim();
    if (!text) return send({ error: 'Claude returned an empty review' });

    let review;
    try {
      review = JSON.parse(text);
    } catch {
      return send({ error: 'Claude returned a malformed review' });
    }
    if (!review || !Array.isArray(review.blockers)) {
      return send({ error: 'Review was missing its blockers' });
    }

    return send({ review });
  } catch (err) {
    const message = controller.signal.aborted
      ? 'The review took too long to generate: try again.'
      : (err?.message || 'Unknown error');
    if (res.headersSent) {
      res.end(JSON.stringify({ error: message }));
      return undefined;
    }
    return res.status(500).json({ error: message });
  } finally {
    clearTimeout(deadline);
  }
}

export default withAuth(handler);
