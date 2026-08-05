// Assertion tests for the failed-read and failed-write advice. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/callStoreError.test.mjs
//
// The whole point of this module is that it must not tell someone to
// reload when reloading cannot work, and must not send someone off to
// fix infrastructure when a retry would have done. Both directions are
// tested, along with the rule that the decision is made on the code and
// never on the message.
import { describeReadFailure, describeWriteFailure, describeDeleteFailure } from '../src/utils/callStoreError.js';

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

// --- writes: nothing was saved is the fact that matters ------------------
// The page deliberately keeps showing a change it couldn't store, so that
// the user's work isn't destroyed on top of not being saved. That makes
// "this is not saved" the one thing every write failure has to say — a
// message that only offered a remedy would leave the screen looking
// correct and lying.
{
  for (const code of ['permission-denied', 'unauthenticated', 'unavailable', 'deadline-exceeded', 'resource-exhausted', 'internal', '']) {
    const d = describeWriteFailure({ ok: false, code, error: 'whatever' });
    ok(d.advice.includes('Nothing was saved'), `a ${code || 'codeless'} write failure says nothing was saved`);
  }
}

// A write is not fixed by reloading the page — it has to be done again —
// so the read advice must never be reused for one.
{
  const denied = describeWriteFailure({ ok: false, code: 'permission-denied', error: 'Missing or insufficient permissions.' });
  eq(denied.permanent, true, 'a denied write is permanent');
  ok(denied.advice.includes('firestore.rules'), 'and points at the ruleset that has to be deployed');
  ok(!denied.advice.includes('Reloading won’t'), 'without telling the user to reload, which does not retry a write');

  const offline = describeWriteFailure({ ok: false, code: 'unavailable', error: 'Failed to reach the backend.' });
  eq(offline.permanent, false, 'an offline write is transient');
  ok(offline.advice.includes('doing again'), 'and says the action has to be repeated, not the page reloaded');

  const expired = describeWriteFailure({ ok: false, code: 'unauthenticated', error: 'Token expired.' });
  ok(expired.advice.includes('Sign out'), 'an expired sign-in says to sign in again');
  ok(expired.advice.includes('do this again'), 'and that the action still has to be repeated afterwards');
}

// The read and write advice for the same code are genuinely different
// text — a single shared sentence would be wrong for one of them.
{
  const code = 'permission-denied';
  const r = describeReadFailure({ ok: false, code, error: 'x' });
  const w = describeWriteFailure({ ok: false, code, error: 'x' });
  ok(r.advice !== w.advice, 'read and write advice differ for the same code');
  eq(r.permanent, w.permanent, 'while agreeing on whether it is permanent');
}

// Same refusals to answer as the read side.
{
  eq(describeWriteFailure(null), null, 'no write failure describes as nothing');
  eq(describeWriteFailure({ ok: true }), null, 'a successful write describes as nothing');
  eq(describeWriteFailure({}), null, 'an empty object is nothing');
  eq(describeWriteFailure({ ok: false, code: '', error: 'Missing or insufficient permissions.' }),
    { permanent: false, advice: 'Nothing was saved. Try again.' },
    'the denial WORDING alone does not make a write failure permanent');
}

// --- deletes get their own wording ---------------------------------------
// Telling someone who pressed Forget that "nothing was saved" says the
// opposite of what happened. These messages only work if the screen can
// be trusted, so the verb has to match the action.
{
  for (const code of ['permission-denied', 'unauthenticated', 'unavailable', 'deadline-exceeded', 'resource-exhausted', 'internal', '']) {
    const d = describeDeleteFailure({ ok: false, code, error: 'whatever' });
    ok(d.advice.includes('Nothing was deleted'), `a ${code || 'codeless'} delete failure says nothing was deleted`);
    ok(!d.advice.includes('Nothing was saved'), `and never says "saved" for a ${code || 'codeless'} delete`);
  }

  const denied = describeDeleteFailure({ ok: false, code: 'permission-denied', error: 'Missing or insufficient permissions.' });
  eq(denied.permanent, true, 'a denied delete is permanent');
  ok(denied.advice.includes('firestore.rules'), 'and points at the same ruleset');

  eq(describeDeleteFailure(null), null, 'no delete failure describes as nothing');
  eq(describeDeleteFailure({ ok: true }), null, 'a successful delete describes as nothing');
}

// All three operations agree on whether a code is permanent — that is a
// property of the failure, not of what was being attempted.
{
  for (const code of ['permission-denied', 'unauthenticated', 'unavailable', 'internal']) {
    const f = { ok: false, code, error: 'x' };
    const [r, w, d] = [describeReadFailure(f), describeWriteFailure(f), describeDeleteFailure(f)];
    ok(r.permanent === w.permanent && w.permanent === d.permanent, `read, write and delete agree that ${code} is${r.permanent ? '' : ' not'} permanent`);
    ok(new Set([r.advice, w.advice, d.advice]).size === 3, `and each gives ${code} its own wording`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
