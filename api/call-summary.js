// Summarizes a call transcript with Claude: executive summary, key
// items, follow-ups with owner/due, next steps, and risks. Mirrors the
// pattern in critique-email.js (withAuth + rate limit + JSON contract).
//
// The transcript arrives from the browser rather than being fetched
// here — the Call Recordings page already holds it, either from a fresh
// AssemblyAI job or from the stored record, and re-fetching it server
// side would mean this route needing OneDrive credentials it otherwise
// has no use for.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

// A two-hour call runs ~120k characters. Claude can take far more, but
// the tail of a long call is where the commitments are, so an
// over-length transcript keeps its head AND tail rather than being cut
// off at the front.
const MAX_CHARS = 120000;
const HEAD_SHARE = 0.4;

function clipTranscript(text) {
  const s = String(text || '');
  if (s.length <= MAX_CHARS) return { text: s, clipped: false };
  const head = Math.floor(MAX_CHARS * HEAD_SHARE);
  const tail = MAX_CHARS - head;
  return {
    text: `${s.slice(0, head)}\n\n[… middle of the call omitted for length …]\n\n${s.slice(-tail)}`,
    clipped: true,
  };
}

const SYSTEM_PROMPT = `You summarize B2B sales call transcripts for a Schneider Electric client director. The transcript is machine-generated, so expect mis-heard words, missing punctuation, and speaker labels like "A"/"B" that you must infer roles for from context.

Be factual and concise. The single most important rule: DO NOT INVENT COMMITMENTS. If nobody stated a deadline, owner, or number, leave it out. A short honest summary beats a padded one.

Return ONLY a JSON object, no prose, no markdown fences:
{
  "summary": "<3-6 sentence executive summary of what the call was about and where it landed>",
  "key_items": ["<concrete fact, requirement, or decision stated on the call>", …],
  "follow_ups": [{ "text": "<the action>", "owner": "<who owns it, or null>", "due": "<date or timeframe as stated, or null>" }, …],
  "next_steps": "<one sentence: the agreed next step, or \\"\\" if none was agreed>",
  "sentiment": "<one of: positive | neutral | cautious | negative>",
  "risks": ["<anything that could stall or lose this deal, drawn from what was actually said>", …]
}

Rules:
- "key_items": 3-8 items. Specifics only: scope, sites, timing, budget, incumbent vendors, decision process. No filler like "they were interested".
- "follow_ups": only actions someone actually committed to. "owner" is the person's name or role as spoken ("Dan", "their facilities lead"); null if unclear. "due" is null unless a date or timeframe was stated.
- "risks" can be empty. Don't manufacture concerns.
- If the transcript is too short, garbled, or clearly not a sales call, say so plainly in "summary" and return empty arrays.`;

function asStringList(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v : v?.text))
    .filter(v => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean)
    .slice(0, limit);
}

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Each call is one Claude request over a long transcript, so the
  // window is tighter than the text-sized routes.
  if (!(await enforceRateLimit(res, auth.uid, 'call-summary', 20, 5 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { transcript = '', company = '', oppContext = '' } = req.body || {};
  const raw = String(transcript || '').trim();
  if (raw.length < 40) {
    return res.status(400).json({ error: 'Transcript is empty or too short to summarize.' });
  }

  const { text, clipped } = clipTranscript(raw);
  const userMessage = `Company: ${String(company || '').trim() || '(unknown)'}
${oppContext ? `Opportunity: ${String(oppContext).trim()}\n` : ''}
Transcript:
${text}

Summarize this call and return the JSON described in the system prompt.`;

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
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Claude API error: ${errText}` });
    }

    const data = await resp.json();
    const out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const objMatch = out.match(/\{[\s\S]*\}/);
    let parsed;
    try {
      parsed = JSON.parse(objMatch ? objMatch[0] : out);
    } catch {
      return res.status(502).json({ error: 'Claude returned malformed JSON', raw: out.slice(0, 500) });
    }

    const followUps = Array.isArray(parsed?.follow_ups)
      ? parsed.follow_ups
          .filter(f => f && typeof f === 'object')
          .map(f => ({
            text: String(f.text || '').trim(),
            owner: f.owner ? String(f.owner).trim() : null,
            due: f.due ? String(f.due).trim() : null,
          }))
          .filter(f => f.text)
          .slice(0, 15)
      : [];

    const sentiment = String(parsed?.sentiment || '').trim().toLowerCase();

    return res.status(200).json({
      summary: String(parsed?.summary || '').trim(),
      keyItems: asStringList(parsed?.key_items, 12),
      followUps,
      nextSteps: String(parsed?.next_steps || '').trim(),
      sentiment: ['positive', 'neutral', 'cautious', 'negative'].includes(sentiment) ? sentiment : '',
      risks: asStringList(parsed?.risks, 8),
      // Surfaced on the page so a summary of a clipped transcript is
      // never mistaken for a summary of the whole call.
      clipped,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export default withAuth(handler);
