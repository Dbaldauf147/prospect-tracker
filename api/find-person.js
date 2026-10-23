// Find who holds a job title at a company, for the "Who is it?" column on
// the Events tab's LinkedIn lookup list. Only suggests: the column shows
// the answer and the user decides whether to put it in the row's Name box.
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { buildRequest, readAnswer } from './_lib/findPerson.js';

// Web search can pause a long turn; it is resumed by sending the partial
// turn back. A few rounds is plenty for one person.
const MAX_ROUNDS = 3;

async function handler(req, res, auth) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'find-person', 60, 5 * 60 * 1000))) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { title, company } = req.body || {};
  if (!String(title || '').trim() || !String(company || '').trim()) {
    return res.status(400).json({ error: 'Missing title or company' });
  }

  const client = new Anthropic();
  try {
    const request = buildRequest(title, company);
    let response;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      response = await client.beta.messages.create(request);
      if (response.stop_reason !== 'pause_turn') break;
      request.messages = [...request.messages, { role: 'assistant', content: response.content }];
    }

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'Claude declined to look this person up.' });
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const answer = readAnswer(text);
    if (!answer) {
      return res.status(502).json({ error: 'Claude returned an answer that could not be read.' });
    }
    return res.status(200).json(answer);
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
