// Assertion tests for the API's thrown-error envelope (api/_lib/http.js).
// Plain Node — no test framework (the project has none). Run:
//   node scripts/apiErrorEnvelope.test.mjs
//
// What's expensive about getting this wrong: a handler that throws used
// to unwind into the platform's own 500, whose body is not JSON. The
// client reads `data.error` there, finds nothing, and shows the bare
// status — so a missing service account, an unreachable Firestore and a
// typo all reach the user as the same "Request failed (500)", with the
// real reason visible only in the deployment logs.
import { failWith } from '../api/_lib/http.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// Minimal stand-in for the platform's response object: records what the
// handler wrote instead of writing it.
function fakeRes(extra = {}) {
  const res = {
    statusCode: null,
    body: null,
    headersSent: false,
    writableEnded: false,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    ...extra,
  };
  return res;
}

// Silence the console.error the envelope makes on the way past — the log
// line is for the deployment, not for this run's output.
const realError = console.error;
console.error = () => {};

{
  const res = fakeRes();
  failWith(res, new Error('5 NOT_FOUND: no such collection'), '/api/company-news-schedules');
  eq(res.statusCode, 500, 'a thrown error answers 500');
  eq(res.body.error, '5 NOT_FOUND: no such collection', 'with the real reason in `error`, which is what the client renders');
  eq(res.body.code, null, 'and a null code when the error carries none');
}

{
  const err = new Error('Missing or insufficient permissions');
  err.code = 7;
  const res = fakeRes();
  failWith(res, err, '/api/company-news-schedules');
  eq(res.body.code, '7', 'an error code rides along as a string, for the cases where the message alone is ambiguous');
}

{
  // What withDeadline throws: a step that ran out of time, not a broken
  // server. 504 is what lets the client offer "try again" honestly.
  const err = new Error("Loading your schedules didn't finish within 12s.");
  err.timedOut = true;
  const res = fakeRes();
  failWith(res, err, '/api/company-news-schedules');
  eq(res.statusCode, 504, 'a deadline answers 504 rather than 500');
  eq(res.body.error, "Loading your schedules didn't finish within 12s.", 'naming the step that stalled');
}

{
  // A handler that already answered and then threw: the reply is the
  // client's, and writing a second one throws on top of it.
  const res = fakeRes({ headersSent: true });
  failWith(res, new Error('too late'), '/api/whatever');
  eq(res.statusCode, null, 'nothing is written over a response already sent');
  eq(res.body, null, 'and no second body');
}

{
  const res = fakeRes({ writableEnded: true });
  failWith(res, new Error('too late'), '/api/whatever');
  eq(res.statusCode, null, 'same once the response has ended');
}

{
  // The condition behind the acquisition-news modal's 500: Firestore
  // refusing every read because the project is out of quota. "Quota
  // exceeded." alone reads like a fault in the route that reported it.
  const err = new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.');
  err.code = 8;
  const res = fakeRes();
  failWith(res, err, '/api/company-news-schedules');
  eq(res.body.error.startsWith('8 RESOURCE_EXHAUSTED: Quota exceeded.'), true, 'the raw Firestore message is kept');
  eq(res.body.error.includes('project-wide'), true, 'and says the quota is the project\'s, not this feature\'s');
  eq(res.body.error.includes('midnight US Pacific'), true, 'and when the free-tier allowance comes back');
}

{
  // An error the hints say nothing about is passed through untouched —
  // no invented advice.
  const err = new Error('9 FAILED_PRECONDITION: The query requires an index.');
  err.code = 9;
  const res = fakeRes();
  failWith(res, err, '/api/company-news-schedules');
  eq(res.body.error, '9 FAILED_PRECONDITION: The query requires an index.', 'an uncatalogued code gets no invented hint');
}

{
  // Handlers throw non-Errors too (a rejected string, a thrown object).
  const res = fakeRes();
  failWith(res, 'plain string failure', '/api/whatever');
  eq(res.body.error, 'plain string failure', 'a thrown non-Error still reports something readable');

  const res2 = fakeRes();
  failWith(res2, null, '/api/whatever');
  eq(res2.body.error, 'Unknown error', 'and a thrown nothing does not render as "null"');
}

console.error = realError;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
