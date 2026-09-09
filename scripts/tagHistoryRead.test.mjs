// Assertion tests for the `tag-history` batch read (api/hubspot.js). Plain
// Node — no test framework (the project has none). Run:
//   node scripts/tagHistoryRead.test.mjs
//
// This endpoint reads HubSpot's property history for dans_tags, which is the
// only record of what a contact used to carry. Two things have to hold:
//
//   * the batch stays inside HubSpot's limit. A read that asks for property
//     HISTORY takes at most 50 inputs — half what a plain batch read takes —
//     and going over is a 400 that returns nothing, not a truncated answer.
//   * versions come back newest-first, because the audit walks them in that
//     order to find the write that took the tags.
import { handlerForTests as handler, TAG_HISTORY_BATCH } from '../api/hubspot.js';

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

const call = async (ids) => {
  const res = fakeRes();
  await handler({ query: { action: 'tag-history' }, body: { ids } }, res);
  return res;
};

// --- HubSpot's limit ------------------------------------------------------
eq(TAG_HISTORY_BATCH, 50, 'a property-history read takes 50 inputs, not the 100 a plain read takes');

{
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) });
  const over = await call(Array.from({ length: 51 }, (_, i) => String(i)));
  eq(over.statusCode, 400, 'a batch over the limit is refused here rather than by HubSpot');
  eq(/50/.test(over.body.error), true, 'and the refusal names the limit');

  const at = await call(Array.from({ length: 50 }, (_, i) => String(i)));
  eq(at.statusCode, 200, 'a full batch at the limit goes through');

  const none = await call([]);
  eq(none.statusCode, 400, 'no ids is a refusal, not an empty read');
}

// --- what it asks for, and what it hands back -----------------------------
{
  let sent = null;
  globalThis.fetch = async (url, opts) => {
    sent = { url, body: JSON.parse(opts.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          id: '101',
          properties: { firstname: 'Ada', lastname: 'Lovelace', email: 'ada@example.com', dans_tags: 'A' },
          // Deliberately oldest-first: the audit walks newest-first, so the
          // endpoint sorts rather than trusting the order it was handed.
          propertiesWithHistory: {
            dans_tags: [
              { value: 'A;B', timestamp: '2026-07-01T09:00:00Z', sourceType: 'CRM_UI', sourceId: 'user' },
              { value: 'A', timestamp: '2026-09-09T14:02:00Z', sourceType: 'INTEGRATION', sourceId: 'app' },
            ],
          },
        }],
      }),
    };
  };
  const res = await call(['101']);
  eq(sent.body.propertiesWithHistory, ['dans_tags'], 'the read asks for the tag history');
  eq(sent.body.inputs, [{ id: '101' }], 'for the ids it was given');
  eq(res.body.rows[0].name, 'Ada Lovelace', 'a row carries the name the report prints');
  eq(res.body.rows[0].current, 'A', 'and what the contact holds now');
  eq(res.body.rows[0].history.map(h => h.timestamp),
    ['2026-09-09T14:02:00Z', '2026-07-01T09:00:00Z'],
    'with the versions newest-first, whatever order HubSpot sent them in');
  eq(res.body.rows[0].history[0].sourceId, 'app', 'each carrying what wrote it');
}

// --- HubSpot saying no ----------------------------------------------------
{
  globalThis.fetch = async () => ({
    ok: false, status: 400, json: async () => ({ message: 'the max number of inputs supported is 50' }),
  });
  const res = await call(['1']);
  eq(res.statusCode, 400, "HubSpot's own refusal is passed through, not swallowed");
  eq(/50/.test(res.body.error), true, 'with the reason it gave');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
