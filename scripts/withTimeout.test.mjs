// Assertion tests for the ceiling on a promise that might never settle.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/withTimeout.test.mjs
//
// The bug behind this: AuthContext awaited Firestore on the sign-in path,
// and `setLoading(false)` sat behind that await. Firestore's setDoc
// resolves on SERVER acknowledgement, so a browser that cannot reach
// firestore.googleapis.com queues the write and leaves the promise
// pending for the life of the tab — it never rejects, so the try/catch
// around it never runs. The app sat on "Loading..." with no error
// anywhere. A hung await has to be turned into a rejection before
// anything can handle it.
import { withTimeout, TimeoutError, isTimeoutError } from '../src/utils/withTimeout.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}
const never = () => new Promise(() => {});
const after = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));

// ── The case that caused the hang ──────────────────────────────────────
{
  // A promise that never settles — exactly what an offline setDoc is.
  let raised = null;
  try { await withTimeout(never(), 20, 'the role lookup'); }
  catch (err) { raised = err; }
  ok(raised instanceof TimeoutError, 'a promise that never settles rejects');
  ok(isTimeoutError(raised), 'and is recognisable as a timeout');
  ok(/the role lookup/.test(raised.message), 'the message names the operation');
  ok(/20ms/.test(raised.message), 'and how long it waited');
}

// ── A promise that answers in time is untouched ────────────────────────
{
  ok(await withTimeout(after(5, 'value'), 200, 'x') === 'value', 'a value that arrives in time passes through');
  ok(await withTimeout(Promise.resolve(7), 200, 'x') === 7, 'an already-resolved promise passes through');
  // undefined is a real Firestore answer, so it must not read as a miss.
  ok(await withTimeout(Promise.resolve(undefined), 200, 'x') === undefined, 'undefined is a value, not a timeout');
}

// ── A real failure stays a real failure ────────────────────────────────
{
  // The timeout must not mask an error the caller wants to see.
  let raised = null;
  try { await withTimeout(Promise.reject(new Error('permission denied')), 200, 'x'); }
  catch (err) { raised = err; }
  ok(raised?.message === 'permission denied', 'an underlying rejection propagates unchanged');
  ok(!isTimeoutError(raised), 'and is not mistaken for a timeout');
}

// ── The timer never outlives the race ──────────────────────────────────
{
  // A leaked timer would hold the event loop open, so a settled call must
  // clear it. If it doesn't, this script hangs instead of exiting — which
  // is the failure mode being guarded against, so assert it directly too.
  const before = process.getActiveResourcesInfo?.().filter(r => r === 'Timeout').length ?? 0;
  await withTimeout(Promise.resolve('quick'), 60000, 'x');
  const after_ = process.getActiveResourcesInfo?.().filter(r => r === 'Timeout').length ?? 0;
  ok(after_ <= before, 'the ceiling timer is cleared when the promise wins');
}

// ── isTimeoutError is not fooled ───────────────────────────────────────
{
  ok(!isTimeoutError(new Error('nope')), 'a plain Error is not a timeout');
  ok(!isTimeoutError(null), 'null is not a timeout');
  ok(!isTimeoutError(undefined), 'undefined is not a timeout');
  // Re-thrown across a boundary that loses the prototype, the name still
  // identifies it — which is how AuthContext tells the two logs apart.
  ok(isTimeoutError({ name: 'TimeoutError' }), 'a structurally-cloned timeout is still recognised');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
