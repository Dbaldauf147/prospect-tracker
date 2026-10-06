// Suggest a vertical for one company, from the user's own Dropdowns ›
// Vertical list. Powers the "Suggest" button beside Vertical on the company
// popup. Only suggests: the popup shows the answer and the user decides
// whether to take it, so nothing here writes to the account.
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { buildRequest, cleanVerticals, readSuggestion } from './_lib/suggestVertical.js';

// A list longer than this is not a dropdown somebody picks from, and an
// enum that size is a schema to compile rather than a classification.
const MAX_VERTICALS = 200;

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'suggest-vertical', 60, 5 * 60 * 1000))) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const body = req.body || {};
  const company = body.company && typeof body.company === 'object' ? body.company : null;
  if (!company || !String(company.company || '').trim()) {
    return res.status(400).json({ error: 'Missing company name' });
  }
  const verticals = cleanVerticals(body.verticals).slice(0, MAX_VERTICALS);
  if (verticals.length === 0) {
    return res.status(400).json({ error: 'The Vertical dropdown list is empty - add verticals under Dropdowns first.' });
  }

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create(buildRequest(company, verticals));

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'Claude declined to classify this company.' });
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const suggestion = readSuggestion(text, verticals);
    if (!suggestion) {
      return res.status(502).json({ error: 'Claude returned an answer that could not be read.' });
    }
    return res.status(200).json(suggestion);
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
