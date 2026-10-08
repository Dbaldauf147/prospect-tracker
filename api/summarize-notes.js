// Summarise opps' running notes (the Next Steps field) into a few bullets
// each. Powers the Notes column on the New Opps and PE Opps subtabs. Read
// only: the summary is shown beside the notes, never written over them.
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { MAX_ITEMS, buildRequest, cleanItems, readSummaries } from './_lib/summarizeNotes.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'summarize-notes', 120, 5 * 60 * 1000))) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const items = cleanItems(req.body?.items).slice(0, MAX_ITEMS);
  if (items.length === 0) {
    return res.status(200).json({ summaries: {} });
  }

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create(buildRequest(items));

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'Claude declined to summarize these notes.' });
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const summaries = readSummaries(text, items);
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
