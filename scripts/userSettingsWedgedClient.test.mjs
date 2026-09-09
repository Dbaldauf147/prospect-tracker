// The save that died with the SDK.
//
// Mapping a company on the Utility Lookup page writes one settings path —
// `utilityLookupCompanyName` — and it came back as:
//
//   Failed to save: FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED:
//   Unexpected state (ID: b815) CONTEXT: {"Pc":"Error: FIRESTORE (12.11.0)
//   INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9) CONTEXT:
//   {\"ve\":-1}"}
//
// Nothing about the mapping caused that. ca9 is the SDK's watch-stream
// assertion (`pendingResponses >= 0` went to -1 on a duplicate target ack)
// and b815 is what every call gets afterwards: the async queue is in a
// permanent failed state, so the stale-check read and the write both reject
// and keep rejecting for the life of the tab. Retrying through the SDK
// cannot work — but the document is still perfectly writable over ordinary
// HTTPS, which is what these tests hold in place.
//
// Run: node scripts/userSettingsWedgedClient.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const { savePathUpdates, saveUserSettings } = await import('../src/utils/userSettingsSync.js');
const health = await import('../src/utils/firestoreClientHealth.js');
const rest = await import('../src/utils/firestoreRest.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const DOC = 'userSettings/u1';

// The error as it actually arrives: the outer assertion quoting the inner
// one that killed the queue.
const wedgedError = () => new Error(
  'FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) '
  + 'CONTEXT: {"Pc":"Error: FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: '
  + 'Unexpected state (ID: ca9) CONTEXT: {\\"ve\\":-1}"}',
);

// Every REST request the fallback makes, so a test can read the URL (the
// update mask lives in the query string) and the body.
let restCalls = [];
const realFetch = globalThis.fetch;
function stubFetch({ status = 200, body = {} } = {}) {
  restCalls = [];
  globalThis.fetch = async (url, init) => {
    restCalls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}
const restore = () => { globalThis.fetch = realFetch; };

const maskOf = (call) => [...new URL(call.url).searchParams.getAll('updateMask.fieldPaths')];

function fresh() {
  fs.reset();
  health.__resetClientHealth();
  restCalls = [];
}

// ── Telling the crash apart from an ordinary failure ───────────────────
{
  ok(health.isClientWedgedError(wedgedError()), 'the b815/ca9 assertion is recognised');
  ok(health.isClientWedgedError(new Error('FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9)')),
    'so is the inner assertion on its own');
  const denied = new Error('Missing or insufficient permissions.');
  denied.code = 'permission-denied';
  ok(!health.isClientWedgedError(denied), 'a rules rejection is not a crashed client');
  ok(!health.isClientWedgedError(new Error('Failed to get document because the client is offline.')),
    'and neither is being offline');
}

// ── The mapping save, with the SDK dead ────────────────────────────────
{
  fresh();
  stubFetch();
  fs.failOn(DOC, wedgedError()); // reads and writes alike, as in the real crash

  const result = await savePathUpdates('u1', { utilityLookupCompanyName: 'Veris Residential' }, { expectedAt: 5 });

  ok(result.stale === false && result.viaRest === true, 'the save reports it went over HTTPS');
  ok(restCalls.length >= 1, 'a REST request was made');
  const write = restCalls[restCalls.length - 1];
  ok(write.method === 'PATCH', 'as a PATCH');
  ok(write.url.startsWith('https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents/userSettings/u1'),
    'against the settings document');
  ok(write.body.fields.utilityLookupCompanyName.stringValue === 'Veris Residential',
    'carrying the mapped company');
  ok(Number(write.body.fields._lastWriteAt.integerValue) > 0, 'and the write stamp other devices watch');
  ok(health.isClientWedged(), 'and the client is marked crashed for the rest of the tab');
  restore();
}

// ── The mask is the whole point ────────────────────────────────────────
//
// A PATCH with no update mask REPLACES the document. Falling back that way
// would trade one lost mapping for every setting the user has.
{
  fresh();
  stubFetch();
  fs.failOn(DOC, wedgedError());

  await savePathUpdates('u1', { utilityLookupCompanyName: 'Veris Residential' }, {});
  const mask = maskOf(restCalls[restCalls.length - 1]);
  ok(mask.length === 2, 'the patch names exactly the fields it writes');
  ok(mask.includes('utilityLookupCompanyName') && mask.includes('_lastWriteAt'),
    'the mapped company and the write stamp — nothing else');
  restore();
}

// ── A path keyed by company slug ───────────────────────────────────────
//
// The manual account count is stored under `utilityLookupAccounts.<slug>`,
// and a slug has hyphens in it. A hyphen is not legal in an unquoted
// Firestore field path, so an unquoted mask is a 400 — the save is lost
// just as surely as before, only now with a different error.
{
  fresh();
  stubFetch();
  fs.failOn(DOC, wedgedError());

  await savePathUpdates('u1', { 'utilityLookupAccounts.veris-residential': 412 }, {});
  const call = restCalls[restCalls.length - 1];
  ok(maskOf(call).includes('utilityLookupAccounts.`veris-residential`'),
    'the hyphenated segment is backtick-quoted in the mask');
  ok(call.body.fields.utilityLookupAccounts.mapValue.fields['veris-residential'].integerValue === '412',
    'and the body nests the value under the parent field');
  restore();
}

// ── Clearing a value ───────────────────────────────────────────────────
{
  fresh();
  stubFetch();
  fs.failOn(DOC, wedgedError());

  await savePathUpdates('u1', { utilityLookupCompanyName: null }, {});
  const call = restCalls[restCalls.length - 1];
  ok(maskOf(call).includes('utilityLookupCompanyName'), 'a cleared path is still in the mask');
  ok(!('utilityLookupCompanyName' in call.body.fields), 'but absent from the body, which is how REST spells a delete');
  restore();
}

// ── Once crashed, stop asking the SDK ──────────────────────────────────
{
  fresh();
  stubFetch();
  fs.failOn(DOC, wedgedError());
  await savePathUpdates('u1', { utilityLookupCompanyName: 'A' }, { expectedAt: 1 });

  const before = fs.calls.length;
  await savePathUpdates('u1', { utilityLookupCompanyName: 'B' }, { expectedAt: 1 });
  ok(fs.calls.length === before, 'the second save makes no SDK call at all');
  ok(restCalls[restCalls.length - 1].body.fields.utilityLookupCompanyName.stringValue === 'B',
    'and still writes the value');
  restore();
}

// ── The stale check, over HTTPS ────────────────────────────────────────
//
// The check exists so two laptops don't erase each other. Losing the SDK
// must not quietly lose it: with the client dead the same read goes over
// REST, and a remote that has moved on still comes back for the merge.
{
  fresh();
  stubFetch({
    body: {
      fields: {
        _lastWriteAt: { integerValue: '9000' },
        utilityLookupCompanyName: { stringValue: 'Set On The Other Laptop' },
        savedFilters: { arrayValue: { values: [{ stringValue: 'mine' }] } },
      },
    },
  });
  fs.failOn(DOC, wedgedError());

  const result = await savePathUpdates('u1', { utilityLookupCompanyName: 'Mine' }, { expectedAt: 100 });
  ok(result.stale === true, 'a newer remote is still detected with the SDK gone');
  ok(result.remoteData.utilityLookupCompanyName === 'Set On The Other Laptop',
    'and the remote document comes back decoded for the merge');
  ok(Array.isArray(result.remoteData.savedFilters) && result.remoteData.savedFilters[0] === 'mine',
    'including its arrays');
  ok(restCalls[0].method === 'GET', 'the check is a plain GET');
  restore();
}

// ── Whole-key saves too ────────────────────────────────────────────────
{
  fresh();
  stubFetch();
  fs.failOn(DOC, wedgedError());

  const result = await saveUserSettings('u1', { 'orgCharts': { 'acme.inc': ['a'] } }, {});
  ok(result.viaRest === true, 'saveUserSettings falls back the same way');
  const mask = maskOf(restCalls[restCalls.length - 1]);
  ok(mask.includes('orgCharts'), 'writing the key it was given');
  restore();
}

// A settings key is free to contain a dot; splitting one would write to a
// nested field nothing reads back.
{
  fresh();
  stubFetch();
  fs.failOn(DOC, wedgedError());

  await saveUserSettings('u1', { 'orgchart-acme.inc': ['a'] }, {});
  const call = restCalls[restCalls.length - 1];
  ok(maskOf(call).includes('`orgchart-acme.inc`'), 'a dotted KEY stays one quoted field path');
  ok(Array.isArray(call.body.fields['orgchart-acme.inc'].arrayValue.values), 'and one top-level field');
  restore();
}

// ── Everything else fails as it always did ─────────────────────────────
{
  fresh();
  stubFetch();
  const denied = new Error('Missing or insufficient permissions.');
  denied.code = 'permission-denied';
  fs.failOn(DOC, denied);

  let threw = null;
  await savePathUpdates('u1', { utilityLookupCompanyName: 'X' }, {}).catch((e) => { threw = e; });
  ok(threw === denied, 'a rules rejection still reaches the caller');
  ok(restCalls.length === 0, 'with no REST attempt behind its back');
  ok(!health.isClientWedged(), 'and the client is not written off');
  restore();
}

// ── A fallback that also fails ─────────────────────────────────────────
{
  fresh();
  stubFetch({ status: 429, body: { error: { message: 'Quota exceeded.' } } });
  fs.failOn(DOC, wedgedError());

  let threw = null;
  await savePathUpdates('u1', { utilityLookupCompanyName: 'X' }, {}).catch((e) => { threw = e; });
  ok(/HTTP 429/.test(threw?.message || '') && /Quota exceeded/.test(threw?.message || ''),
    'the caller hears the real reason, not the assertion');
  restore();
}

// ── Value encoding, both ways ──────────────────────────────────────────
{
  const round = (v) => rest.fromRestValue(rest.toRestValue(v));
  ok(round('x') === 'x', 'strings round-trip');
  ok(round(7) === 7 && round(1.5) === 1.5, 'integers and doubles round-trip');
  ok(round(true) === true && round(null) === null, 'booleans and null round-trip');
  const nested = round({ a: [1, { b: 'c' }], d: false });
  ok(nested.a[1].b === 'c' && nested.d === false, 'nested maps and arrays round-trip');
  ok(rest.toRestValue(7).integerValue === '7', 'an integer is not sent as a double');
  ok(rest.toFieldPath(['a', 'b-c']) === 'a.`b-c`', 'only the segments that need quoting get it');
}

// ── What the user is told ──────────────────────────────────────────────
{
  health.__resetClientHealth();
  const saved = health.wedgedClientMessage(true);
  ok(/^Saved/.test(saved) && /[Rr]eload/.test(saved),
    'a save that landed leads with that, and still says to reload');
  ok(!/ASSERTION|b815|ca9/.test(saved), 'and never quotes the assertion at the user');
  ok(/[Rr]eload/.test(health.wedgedClientMessage(false)), 'a lost save says to reload and try again');
  ok(health.shouldAnnounceWedgedClient() === true, 'the notice is offered once');
  ok(health.shouldAnnounceWedgedClient() === false, 'and not again');
}

restore();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
