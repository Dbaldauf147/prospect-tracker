// Assertion tests for the failed-read advice. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/callReadError.test.mjs
//
// The whole point of this module is that it must not tell someone to
// reload when reloading cannot work, and must not send someone off to
// fix infrastructure when a retry would have done. Both directions are
// tested, along with the rule that the decision is made on the code and
// never on the message.
import { describeReadFailure } from '../src/utils/callReadError.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

// --- nothing failed ------------------------------------------------------
{
  eq(describeReadFailure(null), null, 'no failure describes as nothing');
  eq(describeReadFailure(undefined), null, 'an undefined failure describes as nothing');
  eq(describeReadFailure({ ok: true, error: '', code: '' }), null, 'a successful read describes as nothing');
  eq(describeReadFailure({}), null, 'an empty object with no error is nothing');
  // ok:true wins even if a stale message is still hanging around.
  eq(describeReadFailure({ ok: true, error: 'old message' }), null, 'a successful read ignores a stale message');
}

// --- the denial that started this ---------------------------------------
// A rules denial re-runs identically on reload. Telling the user to
// refresh is the failure this module exists to fix.
{
  const d = describeReadFailure({ ok: false, code: 'permission-denied', error: 'Missing or insufficient permissions.' });
  eq(d.permanent, true, 'a permission denial is permanent');
  ok(d.advice.includes('won’t change this'), 'and says outright that reloading will not help');
  ok(d.advice !== 'Reload to try again.', 'rather than the retry advice that started this');
  ok(d.advice.includes('firestore.rules'), 'it names the file that has to be deployed');
}

// A bad credential is equally permanent, but has a different remedy —
// signing in again, not deploying anything.
{
  const d = describeReadFailure({ ok: false, code: 'unauthenticated', error: 'Missing or invalid token.' });
  eq(d.permanent, true, 'an expired sign-in is permanent');
  ok(d.advice.includes('Sign out'), 'and says to sign in again rather than to deploy rules');
  ok(!d.advice.includes('firestore.rules'), 'the rules remedy is not offered for a credential problem');
}

// --- failures a reload really does fix ----------------------------------
{
  const offline = describeReadFailure({ ok: false, code: 'unavailable', error: 'Failed to get documents from server.' });
  eq(offline.permanent, false, 'being offline is transient');
  ok(offline.advice.includes('online'), 'and says what to wait for, not just to try again');

  const slow = describeReadFailure({ ok: false, code: 'deadline-exceeded', error: 'Deadline exceeded.' });
  eq(slow.permanent, false, 'a timeout is transient');

  const throttled = describeReadFailure({ ok: false, code: 'resource-exhausted', error: 'Quota exceeded.' });
  eq(throttled.permanent, false, 'being rate-limited is transient');
  ok(throttled.advice.includes('Wait'), 'and says to wait before reloading');
}

// --- the unknown case defaults to retrying -------------------------------
// Sending someone after infrastructure they may not need to touch is the
// worse error, so anything unrecognised is treated as worth a retry.
{
  const unknown = describeReadFailure({ ok: false, code: 'internal', error: 'Internal error.' });
  eq(unknown.permanent, false, 'an unrecognised code is treated as retryable');
  eq(unknown.advice, 'Reload to try again.', 'and gets the plain retry advice');

  const codeless = describeReadFailure({ ok: false, error: 'Something went wrong.' });
  eq(codeless.permanent, false, 'a failure with no code at all is retryable');
  ok(codeless.advice, 'and still gets advice rather than nothing');
}

// --- the decision is made on the code, never the message -----------------
// Google can reword its messages; the codes are the contract. A UI that
// matched on prose would silently give the wrong advice the day it
// changed, which is exactly the bug this module replaces.
{
  const worded = describeReadFailure({ ok: false, code: '', error: 'Missing or insufficient permissions.' });
  eq(worded.permanent, false, 'the denial WORDING alone does not make a failure permanent');

  const coded = describeReadFailure({ ok: false, code: 'permission-denied', error: 'some future rewording' });
  eq(coded.permanent, true, 'the denial CODE does, whatever the message says');
}

// --- shapes that shouldn't crash it --------------------------------------
{
  ok(describeReadFailure({ ok: false, code: null, error: null }), 'a failure with null fields still describes');
  ok(describeReadFailure({ ok: false }), 'ok:false alone is enough to describe a failure');
  eq(describeReadFailure({ error: '   ' }), null, 'whitespace-only error with no code is nothing');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
