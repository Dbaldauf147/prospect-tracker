// Assertion tests for the `contact-tags` batch read (api/hubspot.js). Plain
// Node — no test framework (the project has none). Run:
//   node scripts/contactTagsRead.test.mjs
//
// This endpoint exists so a bulk tag edit builds its write from what HubSpot
// holds right now rather than from the client's cached snapshot. Two things
// have to hold for that to be worth anything:
//
//   * every selected contact is read, in chunks HubSpot will accept (its
//     batch read takes at most 100 inputs per call), and
//   * an id HubSpot has no contact for comes back in `missing` rather than
//     as an empty tag string — the caller skips those, because "no tags"
//     would turn a bulk add into a bulk wipe.
import { handlerForTests as handler } from '../api/hubspot.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

process.env.HUBSPOT_ACCESS_TOKEN = 'test-token';

function fakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

// Stands in for HubSpot's batch read: returns a result per requested id that
// the fixture knows about, and simply omits the ones it doesn't — which is
// how HubSpot itself answers for a contact that has been deleted or merged
// away. Records every request so the chunking can be asserted.
function stubHubSpot(known) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, inputs: body.inputs.map(i => i.id), properties: body.properties });
    const results = body.inputs
      .filter(i => Object.prototype.hasOwnProperty.call(known, i.id))
      .map(i => ({ id: i.id, properties: { dans_tags: known[i.id] } }));
    return { ok: true, status: 200, json: async () => ({ results }), text: async () => '' };
  };
  return calls;
}

const realFetch = globalThis.fetch;

// ── Reads what HubSpot holds, and reports what it doesn't have ───────────
{
  const calls = stubHubSpot({
    '101': 'ESG;Efficiency / Renewables',
    '102': '',
  });
  const res = fakeRes();
  await handler({ method: 'POST', query: { action: 'contact-tags' }, body: { contactIds: ['101', '102', '103'] } }, res);
  eq(res.body, { tags: { '101': 'ESG;Efficiency / Renewables', '102': '' }, missing: ['103'] },
    'returns live tags per id, with the ids HubSpot has no contact for listed separately');
  eq(calls[0].properties, ['dans_tags'], 'asks HubSpot for dans_tags only');
  eq(calls[0].url, 'https://api.hubapi.com/crm/v3/objects/contacts/batch/read',
    'uses the batch read endpoint');
  eq(calls.length, 1, 'one call for a small selection');
}

// A contact HubSpot holds with an empty tag string is NOT missing: it can be
// written to. Only an id with no contact behind it is skipped.
{
  stubHubSpot({ '200': '' });
  const res = fakeRes();
  await handler({ method: 'POST', query: { action: 'contact-tags' }, body: { contactIds: ['200'] } }, res);
  eq(res.body, { tags: { '200': '' }, missing: [] },
    'an untagged contact reads as empty tags, not as missing');
}

// ── Chunking ─────────────────────────────────────────────────────────────
{
  const known = {};
  const ids = [];
  for (let i = 0; i < 250; i++) { ids.push(String(i)); known[String(i)] = 'ESG'; }
  const calls = stubHubSpot(known);
  const res = fakeRes();
  await handler({ method: 'POST', query: { action: 'contact-tags' }, body: { contactIds: ids } }, res);
  eq(calls.map(c => c.inputs.length), [100, 100, 50],
    '250 contacts go out in chunks HubSpot will accept');
  eq(Object.keys(res.body.tags).length, 250, 'every contact comes back');
  eq(res.body.missing, [], 'none reported missing');
}

// ── Input handling ───────────────────────────────────────────────────────
{
  const calls = stubHubSpot({ '1': 'ESG' });
  const res = fakeRes();
  await handler({ method: 'POST', query: { action: 'contact-tags' }, body: { contactIds: ['1', ' 1 ', '', null, 1] } }, res);
  eq(calls[0].inputs, ['1'], 'ids are trimmed, blanks dropped, repeats collapsed');
  eq(res.body.missing, [], 'nothing spurious reported missing');
}

{
  stubHubSpot({});
  const res = fakeRes();
  await handler({ method: 'POST', query: { action: 'contact-tags' }, body: { contactIds: [] } }, res);
  eq(res.body, { tags: {}, missing: [] }, 'an empty selection asks HubSpot nothing');
}

globalThis.fetch = realFetch;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
