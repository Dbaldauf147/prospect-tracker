// Summarizes a call transcript with Claude: executive summary, key
// items, follow-ups with owner/due, next steps, and risks. Mirrors the
// pattern in critique-email.js (withAuth + rate limit + JSON contract).
//
// The transcript arrives from the browser rather than being fetched
// here — the Call Recordings page already holds it, either from a fresh
// AssemblyAI job or from the stored record, and re-fetching it server
// side would mean this route needing OneDrive credentials it otherwise
// has no use for.
//
// The summary ADAPTS to what kind of meeting it was. Not every recording
// on the page is a sales call: the Granola sync pulls in internal
// stand-ups and delivery reviews alongside prospect calls, and asking
// for budget, incumbent vendors, and deal risk from a team stand-up
// produces empty sections at best and invented ones at worst. So the
// model classifies the meeting first, in the same request, and the
// sections it fills are the ones that type actually has.
//
// The taxonomy and the section guidance are kept in step with the
// meeting-recap skill in plugins/meeting-notes — the two write the same
// record, so a recap filed by the plugin and one produced by this route
// should not read like different documents.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

// A two-hour call runs ~120k characters. Claude can take far more, but
// the tail of a long call is where the commitments are, so an
// over-length transcript keeps its head AND tail rather than being cut
// off at the front.
const MAX_CHARS = 120000;
const HEAD_SHARE = 0.4;

export function clipTranscript(text) {
  const s = String(text || '');
  if (s.length <= MAX_CHARS) return { text: s, clipped: false };
  const head = Math.floor(MAX_CHARS * HEAD_SHARE);
  const tail = MAX_CHARS - head;
  return {
    text: `${s.slice(0, head)}\n\n[… middle of the call omitted for length …]\n\n${s.slice(-tail)}`,
    clipped: true,
  };
}

// The three meeting types, and '' for a transcript the model could not
// place. Anything outside this set is dropped rather than stored: the
// page renders the type as a label, and an unknown one would read as a
// category that exists.
export const MEETING_TYPES = ['sales', 'client', 'internal'];

const SYSTEM_PROMPT = `You summarize meeting transcripts for a Schneider Electric client director. The transcript is machine-generated, so expect mis-heard words, missing punctuation, and speaker labels like "A"/"B" that you must infer roles for from context.

Be factual and concise. The single most important rule: DO NOT INVENT COMMITMENTS. If nobody stated a deadline, owner, or number, leave it out. A short honest summary beats a padded one.

FIRST, decide what kind of meeting this was. It changes what belongs in the summary:
- "sales" — external attendees, no signed deal yet. Talk of scope, pricing, timeline, competitors.
- "client" — external attendees on existing work. Performance, delivery, escalations, renewal.
- "internal" — everyone is a colleague. No customer in the room.
Mixed internal and external attendees means the EXTERNAL type: the customer's presence is what makes the meeting consequential. A prospect meeting that is really an internal prep call is "internal" — who was in the room decides, not what was discussed. If the transcript genuinely does not say, use "" and lead the summary with the fact that the type was unclear.

Return ONLY a JSON object, no prose, no markdown fences:
{
  "meeting_type": "<one of: sales | client | internal, or \\"\\" if genuinely unclear>",
  "summary": "<3-6 sentence executive summary of what the meeting was about and where it landed>",
  "key_items": ["<concrete fact, requirement, or decision stated on the call>", …],
  "follow_ups": [{ "text": "<the action>", "owner": "<who owns it, or null>", "due": "<date or timeframe as stated, or null>" }, …],
  "next_steps": "<one sentence: the agreed next step, or \\"\\" if none was agreed>",
  "sentiment": "<one of: positive | neutral | cautious | negative>",
  "risks": ["<anything that could stall this, drawn from what was actually said>", …]
}

Rules:
- "summary": lead with the decision or the outcome, not the agenda. Never open with "The team discussed" or "This meeting covered" — those carry no information. Name real platforms, sites, metrics, and dates.
- "key_items": 3-8 items, one line each. Specifics only, no filler like "they were interested". What counts as a specific depends on the type:
  - sales: scope, sites and volumes, budget and who controls it, decision process and timing, incumbent vendors, stated objections.
  - client: performance against what was promised, delivery status, escalations, scope changes, renewal or expansion signals.
  - internal: decisions made, positions taken, blockers named, and what was explicitly deferred.
- "follow_ups": only actions someone actually committed to. "owner" is the person's name or role as spoken ("Dan", "their facilities lead"); null if unclear. "due" is null unless a date or timeframe was stated. Do not assign an unowned action to whoever spoke most — leave the owner null.
- "sentiment": read the DIRECTION this is heading, not the tone of the conversation. A friendly call where the budget got frozen is "cautious". For internal meetings, read whether the work is on track.
- "risks" can be empty, and often is. Don't manufacture concerns — an invented risk sends someone chasing a problem that does not exist. For "internal", these are delivery and commitment risks rather than deal risks.
- If the transcript is too short, garbled, or clearly not a meeting worth filing, say so plainly in "summary" and return empty arrays. That is a correct answer, not a failure to try.`;

/**
 * A one-line description of who was on the call, prepended to the
 * transcript so the model can classify from the attendee list rather
 * than inferring it from speaker labels alone.
 *
 * Domains are what separate colleagues from the other side, so each
 * attendee is marked internal or external relative to the note owner's
 * domain. Names are deliberately left out: the transcript already has
 * them, and the domain is the part that carries the signal.
 */
export function attendeeContext(attendees, owner) {
  const ownDomain = domainOf(owner?.email);
  const domains = new Set();
  for (const person of Array.isArray(attendees) ? attendees : []) {
    const domain = domainOf(person?.email);
    if (domain) domains.add(domain);
  }
  if (domains.size === 0) return '';

  const sorted = [...domains].sort();
  const external = sorted.filter(d => d !== ownDomain);
  const parts = [`Attendee domains: ${sorted.join(', ')}`];
  if (ownDomain) parts.push(`the organiser is @${ownDomain}`);
  parts.push(external.length === 0
    ? 'everyone shares the organiser\'s domain'
    : `${external.length} external domain${external.length === 1 ? '' : 's'}: ${external.join(', ')}`);
  return `${parts.join('; ')}.`;
}

function domainOf(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase().trim() : '';
}

function asStringList(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v : v?.text))
    .filter(v => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean)
    .slice(0, limit);
}

const SENTIMENTS = ['positive', 'neutral', 'cautious', 'negative'];

/**
 * Claude's JSON → the response the page stores.
 *
 * Every field is bounded or vocabulary-checked here rather than trusted.
 * The model is asked for a closed set of meeting types and sentiments,
 * and mostly obeys — but "prospect" instead of "sales" would be stored
 * and rendered as a category the page does not have, so anything off the
 * list becomes '' and the page shows no label at all.
 */
export function normalizeSummary(parsed) {
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
  const meetingType = String(parsed?.meeting_type || '').trim().toLowerCase();

  return {
    meetingType: MEETING_TYPES.includes(meetingType) ? meetingType : '',
    summary: String(parsed?.summary || '').trim(),
    keyItems: asStringList(parsed?.key_items, 12),
    followUps,
    nextSteps: String(parsed?.next_steps || '').trim(),
    sentiment: SENTIMENTS.includes(sentiment) ? sentiment : '',
    risks: asStringList(parsed?.risks, 8),
  };
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

  const {
    transcript = '', company = '', oppContext = '', attendees = null, owner = null,
  } = req.body || {};
  const raw = String(transcript || '').trim();
  if (raw.length < 40) {
    return res.status(400).json({ error: 'Transcript is empty or too short to summarize.' });
  }

  const { text, clipped } = clipTranscript(raw);
  // Who was in the room is the strongest signal for internal vs
  // external, and it is the one thing the transcript itself does not
  // reliably carry — machine speaker labels are "A"/"B".
  const whoWasThere = attendeeContext(attendees, owner);
  const userMessage = `Company: ${String(company || '').trim() || '(unknown)'}
${oppContext ? `Opportunity: ${String(oppContext).trim()}\n` : ''}${whoWasThere ? `${whoWasThere}\n` : ''}
Transcript:
${text}

Classify and summarize this meeting, and return the JSON described in the system prompt.`;

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

    return res.status(200).json({
      ...normalizeSummary(parsed),
      // Surfaced on the page so a summary of a clipped transcript is
      // never mistaken for a summary of the whole call.
      clipped,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export default withAuth(handler);
