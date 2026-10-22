// Summarise opps' running notes (the Next Steps field) into a few bullets
// each. Powers the Notes column on the New Opps and PE Opps subtabs. With
// `kind: 'scope'` it summarises each opp's Scope into one line instead, for
// the Scope column on New Opps and its email, and with `kind: 'scope-deck'`
// into a sentence or two for the Opps PPT. Read only: a summary is shown
// beside what it summarises, never written over it.
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { MAX_ITEMS, buildRequest, cleanItems, readSummaries } from './_lib/summarizeNotes.js';
import { buildScopeRequest, readScopeSummaries, buildDeckScopeRequest, readDeckScopeSummaries } from './_lib/summarizeScope.js';

// Each kind's request and reader. Both answer { [id]: string[] }.
const KINDS = {
  notes: { build: buildRequest, read: readSummaries, what: 'notes' },
  scope: { build: buildScopeRequest, read: readScopeSummaries, what: 'scopes' },
  // A sentence or two of plain English per opp, for the Opps PPT.
  'scope-deck': { build: buildDeckScopeRequest, read: readDeckScopeSummaries, what: 'scopes' },
};

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'summarize-notes', 120, 5 * 60 * 1000))) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const kind = KINDS[req.body?.kind || 'notes'];
  if (!kind) {
    return res.status(400).json({ error: 'Unknown summary kind' });
  }

  const items = cleanItems(req.body?.items).slice(0, MAX_ITEMS);
  if (items.length === 0) {
    return res.status(200).json({ summaries: {} });
  }

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create(kind.build(items));

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: `Claude declined to summarize these ${kind.what}.` });
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const summaries = kind.read(text, items);
    if (!summaries) {
      return res.status(502).json({ error: 'Claude returned an answer that could not be read.' });
    }
    return res.status(200).json({ summaries });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Claude is rate-limited right now - try again in a minute.' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Claude API error ${err.status ?? ''}: ${err.message}`.trim() });
    }
    throw err;
  }
}

export default withAuth(handler);
