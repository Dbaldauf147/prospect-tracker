// "Research with Claude" on the company popup's "Who does it here?"
// section: asks each standard question of the public web for one company
// and returns the people found, each with the page that names them. Only
// suggests: the popup shows the findings and the user saves the names they
// trust, so nothing here writes to the account.
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { buildRequest, cleanQuestions, readPeople } from './_lib/whoDoesResearch.js';

// Web search can hand the turn back (pause_turn) mid-research; it is
// continued by sending the partial answer back. A few rounds is plenty
// for a handful of questions, and the cap keeps a stuck turn finite.
const MAX_CONTINUATIONS = 4;
// Questions are researched side by side, this many at a time, and all of
// it has to finish inside the function's 300 seconds.
const CONCURRENCY = 6;
const DEADLINE_MS = 270 * 1000;

// One question: its people, or null when the answer could not be read.
// Throws on an API error, which marks that question failed.
async function researchOne(client, company, question, deadline) {
  const request = buildRequest(company, question);
  const timeout = () => Math.max(5000, deadline - Date.now());
  let response = await client.beta.messages.create(request, { timeout: timeout() });
  for (let i = 0; response.stop_reason === 'pause_turn' && i < MAX_CONTINUATIONS && Date.now() < deadline; i++) {
    request.messages = [...request.messages, { role: 'assistant', content: response.content }];
    response = await client.beta.messages.create(request, { timeout: timeout() });
  }
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return readPeople(text);
}

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

  const client = new Anthropic({ maxRetries: 1 });
  const deadline = Date.now() + DEADLINE_MS;
  const answers = {};
  const failed = [];
  const errors = [];
  let next = 0;
  const worker = async () => {
    while (next < questions.length) {
      const q = questions[next++];
      if (Date.now() >= deadline) { failed.push(q.id); continue; }
      try {
        const people = await researchOne(client, company, q, deadline);
        if (people) answers[q.id] = people;
        else failed.push(q.id);
      } catch (err) {
        failed.push(q.id);
        errors.push(err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, questions.length) }, worker));

  // Every question failing is an error; some failing still returns what
  // was found, with the failed ones named so the card can say so.
  if (failed.length === questions.length) {
    const err = errors[0];
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Claude is rate-limited right now. Try again in a minute.' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Claude API error ${err.status ?? ''}: ${err.message}`.trim() });
    }
    if (err) throw err;
    return res.status(502).json({ error: 'Claude returned answers that could not be read. Try again.' });
  }
  return res.status(200).json({ answers, failed });
}

export default withAuth(handler);
