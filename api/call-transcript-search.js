// Topic search over a call transcript: ask a question, get an answer
// plus the verbatim moments it came from, each with a timestamp the
// player can seek to.
//
// The transcript is posted from the browser for the same reason as
// call-summary.js — the page already has it, and fetching it here would
// mean this route needing OneDrive credentials.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

// Speaker-labelled turns are what make timestamps possible, so they're
// preferred over the flat transcript. A long call can run to thousands
// of turns; this is the ceiling on how many are sent.
const MAX_UTTERANCES = 1200;
const MAX_FLAT_CHARS = 100000;

// AssemblyAI reports utterance offsets in milliseconds. Everything the
// browser seeks with is seconds, so the conversion happens here, once.
function msToSec(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n / 1000) : null;
}

function fmtClock(sec) {
  if (sec == null) return '?';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Build the transcript block the model reads. With turns, each line is
// prefixed with its start time and speaker so the model can cite a real
// timestamp instead of guessing one.
function buildBlock(utterances, transcript) {
  const turns = Array.isArray(utterances) ? utterances : [];
  if (turns.length > 0) {
    const lines = turns.slice(0, MAX_UTTERANCES).map((u) => {
      const start = msToSec(u?.start);
      const speaker = String(u?.speaker || '?').trim();
      const text = String(u?.text || '').trim();
      return text ? `[${start ?? '?'}s ${fmtClock(start)}] Speaker ${speaker}: ${text}` : '';
    }).filter(Boolean);
    return {
      block: lines.join('\n'),
      hasTimestamps: true,
      truncated: turns.length > MAX_UTTERANCES,
    };
  }
  const flat = String(transcript || '');
  return {
    block: flat.slice(0, MAX_FLAT_CHARS),
    hasTimestamps: false,
    truncated: flat.length > MAX_FLAT_CHARS,
  };
}

function systemPrompt(hasTimestamps) {
  const timing = hasTimestamps
    ? 'Each line is prefixed with its start time in seconds, as [123s 2:03]. Set "start_sec" to the start time of the line your quote came from: copy it, never estimate it. Set "end_sec" to the start time of the following line, or null if the quote is from the last line.'
    : 'No timestamps are available for this transcript. Set "start_sec" and "end_sec" to null on every finding, and do not guess at times.';

  return `You answer questions about B2B sales call transcripts. The transcript is machine-generated, so expect mis-heard words and speaker labels like "A"/"B" whose roles you infer from context.

Answer ONLY from the transcript. Never invent quotes, names, numbers, or commitments. Every quote must be a verbatim excerpt of at most about 40 words. If the transcript does not address the question, say so in "answer" and return an empty "findings" array: that is a correct result, not a failure.

${timing}

Return ONLY a JSON object, no prose, no markdown fences:
{
  "answer": "<a short paragraph answering the question from the transcript>",
  "findings": [{ "quote": "<verbatim excerpt>", "start_sec": <number or null>, "end_sec": <number or null>, "note": "<one line on why this moment answers the question>" }, …]
}

Return at most 8 findings, ordered as they occur in the call.`;
}

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'call-transcript-search', 40, 5 * 60 * 1000))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { transcript = '', utterances = [], question = '' } = req.body || {};
  const q = String(question || '').trim();
  if (!q) return res.status(400).json({ error: 'Ask a question to search for.' });
  if (!String(transcript || '').trim() && !(Array.isArray(utterances) && utterances.length)) {
    return res.status(400).json({ error: 'This recording has no transcript yet.' });
  }

  const { block, hasTimestamps, truncated } = buildBlock(utterances, transcript);

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
        system: systemPrompt(hasTimestamps),
        messages: [{
          role: 'user',
          content: `Question / topic: ${q}\n\nTranscript:\n${block}`,
        }],
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

    const findings = (Array.isArray(parsed?.findings) ? parsed.findings : [])
      .filter(f => f && typeof f === 'object')
      .map((f) => {
        const start = Number(f.start_sec);
        const end = Number(f.end_sec);
        return {
          quote: String(f.quote || '').trim(),
          note: String(f.note || '').trim(),
          // Times are only meaningful when the model had timestamps to
          // copy; without them anything returned here is a guess.
          startSec: hasTimestamps && Number.isFinite(start) ? Math.max(0, Math.round(start)) : null,
          endSec: hasTimestamps && Number.isFinite(end) ? Math.max(0, Math.round(end)) : null,
        };
      })
      .filter(f => f.quote)
      .sort((a, b) => (a.startSec ?? Number.MAX_SAFE_INTEGER) - (b.startSec ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 8);

    return res.status(200).json({
      answer: String(parsed?.answer || '').trim(),
      findings,
      hasTimestamps,
      truncated,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export default withAuth(handler);
