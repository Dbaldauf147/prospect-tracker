// The "Suggest" button beside Vertical on the company popup.
//
// The rules worth pinning: the model can only answer with a vertical on the
// user's own list (the schema's enum, then a second check on our side, so a
// stray value never reaches the field), "no fit" is an answer rather than a
// guess, and the prompt carries what the card knows without blank lines for
// what it doesn't.
//
// Run: node scripts/suggestVertical.test.mjs
import Anthropic from '@anthropic-ai/sdk';
import { cleanVerticals, buildRequest, buildUserPrompt, outputSchema, readSuggestion } from '../api/_lib/suggestVertical.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const list = cleanVerticals([' Chemicals ', 'Industrial', 'chemicals', '', null, 'Real Estate']);
check('the list is trimmed and de-duplicated', list, ['Chemicals', 'Industrial', 'Real Estate']);
check('no list is an empty list', cleanVerticals(undefined), []);

const schema = outputSchema(list);
check('the answer can only be a listed vertical or none', schema.properties.vertical.enum, ['Chemicals', 'Industrial', 'Real Estate', '']);
check('every field is required and nothing else allowed', [schema.required, schema.additionalProperties], [['vertical', 'confidence', 'reason'], false]);

const prompt = buildUserPrompt({ company: 'Oxea (a SVP co.)', website: 'https://www.oxea.com/', bfoCompanyName: 'OXEA Corporation', peOwner: 'Strategic Value Partners (SVP) Global', aliases: '', type: 'Portfolio Company' }, list);
check('the prompt carries what the card knows', prompt.includes('Website: https://www.oxea.com/') && prompt.includes('Owner / parent company: Strategic Value Partners'), true);
check('and leaves out what it does not', prompt.includes('Also known as'), false);
check('and lists the verticals', prompt.endsWith('Verticals:\n- Chemicals\n- Industrial\n- Real Estate'), true);

check('a listed answer comes back in the list spelling',
  readSuggestion('{"vertical":"chemicals","confidence":"high","reason":"Makes oxo chemicals."}', list),
  { vertical: 'Chemicals', confidence: 'high', reason: 'Makes oxo chemicals.' });
check('an unlisted answer is dropped, not passed through',
  readSuggestion('{"vertical":"Petrochemicals","confidence":"high","reason":"x"}', list).vertical, '');
check('no fit stays no fit',
  readSuggestion('{"vertical":"","confidence":"low","reason":"Unknown company."}', list),
  { vertical: '', confidence: 'low', reason: 'Unknown company.' });
check('an odd confidence reads as low', readSuggestion('{"vertical":"Industrial","confidence":"sure","reason":""}', list).confidence, 'low');
check('unreadable text is null', readSuggestion('not json', list), null);

// What the SDK actually puts on the wire, and that it reads the reply back,
// against a stand-in for the API (no key or network in the test run).
{
  let sent = null;
  const fakeFetch = async (url, init) => {
    sent = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: '{"vertical":"Chemicals","confidence":"high","reason":"Oxo chemicals maker."}' }],
      stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new Anthropic({ apiKey: 'test', fetch: fakeFetch, maxRetries: 0 });
  const response = await client.beta.messages.create(buildRequest({ company: 'Oxea' }, list));
  check('posts to the Messages API', sent.url.endsWith('/v1/messages?beta=true') || sent.url.endsWith('/v1/messages'), true);
  check('with the fallback beta header', (sent.headers.get('anthropic-beta') || '').includes('server-side-fallback-2026-07-01'), true);
  check('the model, fallback, effort and schema in the body',
    [sent.body.model, sent.body.fallbacks, sent.body.output_config.effort, sent.body.output_config.format.type, 'betas' in sent.body],
    ['claude-opus-5-5', 'default', 'low', 'json_schema', false]);
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  check('and the reply reads back as a suggestion', readSuggestion(text, list).vertical, 'Chemicals');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
