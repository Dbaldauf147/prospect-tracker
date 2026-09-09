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
import { handlerForTests as handler, TAG_HISTORY_BATCH, fetchRetryingRateLimit } from '../api/hubspot.js';

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

// --- waiting out the rate limiter -----------------------------------------
//
// HubSpot answers a burst with a 429 and usually a Retry-After. That is the
// portal saying "in a moment", not a failure, and dropping the contacts the
// batch was handed would make a long audit unfinishable on a busy portal.
{
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); };
  const responses = (...statuses) => {
    let i = 0;
    globalThis.fetch = async () => {
      const status = statuses[Math.min(i++, statuses.length - 1)];
      return { ok: status < 400, status, headers: { get: () => null }, json: async () => ({ results: [] }) };
    };
  };

  responses(429, 200);
  let res = await fetchRetryingRateLimit('u', {}, { sleep });
  eq([res.status, waits.length], [200, 1], 'a 429 is waited out and asked again');

  waits.length = 0;
  responses(429, 429, 200);
  res = await fetchRetryingRateLimit('u', {}, { sleep });
  eq([res.status, waits], [200, [500, 1000]], 'and the wait climbs while it keeps saying no');

  waits.length = 0;
  responses(429);
  res = await fetchRetryingRateLimit('u', {}, { sleep });
  eq([res.status, waits.length], [429, 3], 'a limiter that never lets up is reported, not waited on forever');

  waits.length = 0;
  responses(503, 200);
  res = await fetchRetryingRateLimit('u', {}, { sleep });
  eq([res.status, waits.length], [200, 1], "HubSpot's own transient failures are retried on the same terms");

  waits.length = 0;
  responses(400);
  res = await fetchRetryingRateLimit('u', {}, { sleep });
  eq([res.status, waits.length], [400, 0], 'a refusal that will not change is not retried');

  // Retry-After wins over the climbing fallback, and is capped so one huge
  // value can't park the request past the function's own timeout.
  waits.length = 0;
  let n = 0;
  globalThis.fetch = async () => (n++ === 0
    ? { ok: false, status: 429, headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? '2' : null) }, json: async () => ({}) }
    : { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ results: [] }) });
  await fetchRetryingRateLimit('u', {}, { sleep });
  eq(waits, [2000], "HubSpot's own Retry-After is honoured");

  waits.length = 0;
  n = 0;
  globalThis.fetch = async () => (n++ === 0
    ? { ok: false, status: 429, headers: { get: () => '600' }, json: async () => ({}) }
    : { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ results: [] }) });
  await fetchRetryingRateLimit('u', {}, { sleep });
  eq(waits, [15000], 'but a ten-minute Retry-After is capped rather than parking the request');
}

// --- what the caller is told when the limiter wins ------------------------
{
  globalThis.fetch = async () => ({
    ok: false, status: 429, headers: { get: () => null },
    json: async () => ({ message: 'There was a problem with the request.' }),
  });
  const res = fakeRes();
  await handler({ query: { action: 'tag-history' }, body: { ids: ['1'] } }, res);
  eq(res.statusCode, 429, 'a rate-limited read is reported as one');
  eq(res.body.rateLimited, true, 'flagged, so the page can say what to do about it');
  eq(/run the audit again/i.test(res.body.error), true,
    "and told in words that say it is the portal being busy, not the audit being broken");
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
