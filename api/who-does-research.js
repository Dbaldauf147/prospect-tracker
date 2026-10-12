// "Research with Claude" on the company popup's "Who does it here?"
// section: asks each standard question of the public web for one company
// and returns the people found, each with the page that names them. Only
// suggests: the popup shows the findings and the user saves the names they
// trust, so nothing here writes to the account.
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { buildRequest, cleanQuestions, readAnswers } from './_lib/whoDoesResearch.js';

// Web search can hand the turn back (pause_turn) mid-research; it is
// continued by sending the partial answer back. A few rounds is plenty
// for a handful of questions, and the cap keeps a stuck turn finite.
const MAX_CONTINUATIONS = 4;

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'who-does-research', 20, 10 * 60 * 1000))) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const body = req.body || {};
  const company = body.company && typeof body.company === 'object' ? body.company : null;
  if (!company || !String(company.company || '').trim()) {
    return res.status(400).json({ error: 'Missing company name' });
  }
  const questions = cleanQuestions(body.questions);
  if (questions.length === 0) {
    return res.status(400).json({ error: 'There are no questions to research. Add one with Edit questions first.' });
  }

  const client = new Anthropic();
  const request = buildRequest(company, questions);
  try {
    let response = await client.beta.messages.create(request);
    for (let i = 0; response.stop_reason === 'pause_turn' && i < MAX_CONTINUATIONS; i++) {
      request.messages = [...request.messages, { role: 'assistant', content: response.content }];
      response = await client.beta.messages.create(request);
    }

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'Claude declined to research this company.' });
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const answers = readAnswers(text, questions);
    if (!answers) {
      return res.status(502).json({ error: 'Claude returned an answer that could not be read. Try again.' });
    }
    return res.status(200).json({ answers });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Claude is rate-limited right now. Try again in a minute.' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Claude API error ${err.status ?? ''}: ${err.message}`.trim() });
    }
    throw err;
  }
}

export default withAuth(handler);
