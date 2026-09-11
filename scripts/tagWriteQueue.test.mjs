// Assertion tests for the tag write queue (src/utils/tagWriteQueue.js) and
// the stale-echo guard it works with (src/utils/contactTagReview.js). Plain
// Node — no test framework (the project has none). Run:
//   node scripts/tagWriteQueue.test.mjs
//
// Both exist because of the same report: tagging a contact was "super slow
// and glitchy", and clicks undid themselves.
//
//   * Slow, because every click sent the whole tag list — a live read, a
//     PATCH, a rewrite of the local contacts cache and the app-wide
//     re-render that broadcast triggers. Six ticks, six of those. A burst
//     is one intention and the last click's list carries every earlier
//     one, so only the last needs sending.
//   * Glitchy, because each write handed its list back through the contact
//     prop as it landed, in whatever order the network managed. The echo of
//     an earlier click arriving after a later one un-ticked what had just
//     been clicked, then put it back a second later.
//
// The queue must never lose a click (a popup can close mid-timer), never
// overlap two whole-list writes, and never report "nothing pending" while
// it still owes HubSpot a write — that flag is what stops the prop echo
// from overwriting newer local state.

import { createTagWriter } from '../src/utils/tagWriteQueue.js';
import { tagListSignature, isStaleTagEcho, TAG_ECHO_WINDOW_MS } from '../src/utils/contactTagReview.js';

let failures = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
}
function eq(label, actual, expected) {
  check(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

// A hand-cranked clock, so a 600ms debounce is tested without waiting 600ms.
function fakeTimers() {
  let t = 0;
  let seq = 0;
  const jobs = new Map();
  return {
    timers: {
      now: () => t,
      setTimeout: (fn, ms) => { const id = ++seq; jobs.set(id, { at: t + ms, fn }); return id; },
      clearTimeout: (id) => { jobs.delete(id); },
    },
    // Advance the clock, running whatever comes due, and let the microtask
    // queue drain so the writes' promises settle.
    async advance(ms) {
      t += ms;
      const due = [...jobs.entries()].filter(([, j]) => j.at <= t).sort((a, b) => a[1].at - b[1].at);
      for (const [id, job] of due) { jobs.delete(id); job.fn(); }
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
    async settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); },
  };
}

function recorder(result = true) {
  const calls = [];
  let resolveNext = null;
  return {
    calls,
    write: (v) => {
      calls.push(v);
      if (typeof result === 'function') return result(v);
      return new Promise(res => { resolveNext = res; res(result); });
    },
    get resolveNext() { return resolveNext; },
  };
}

// --- one write per burst ---------------------------------------------------

{
  const clock = fakeTimers();
  const rec = recorder();
  const w = createTagWriter({ write: rec.write, delayMs: 600, maxWaitMs: 2500, timers: clock.timers });
  const results = [w.push('ESG'), w.push('ESG;Procurement'), w.push('ESG;Procurement;EU')];
  eq('a burst of clicks sends nothing while it is still arriving', rec.calls, []);
  check('and the queue says it owes a write the whole time', w.pending() === 1);
  await clock.advance(600);
  eq('one write goes out, carrying the last click’s whole list', rec.calls, ['ESG;Procurement;EU']);
  eq('and every click in the burst hears that it landed', await Promise.all(results), [true, true, true]);
  check('with nothing left pending', w.pending() === 0);
}

// --- the clicks that keep coming -------------------------------------------

{
  const clock = fakeTimers();
  const rec = recorder();
  const w = createTagWriter({ write: rec.write, delayMs: 600, maxWaitMs: 2000, timers: clock.timers });
  w.push('a');
  // Clicking every 500ms never lets a 600ms debounce fire on its own, so the
  // backstop is what gets the work out: at 2000ms the oldest unsent click has
  // waited long enough and the list as it stands then goes out.
  for (let i = 0; i < 4; i++) { await clock.advance(500); w.push('a'.repeat(i + 2)); }
  eq('steady clicking reaches HubSpot by the backstop rather than sitting in a timer',
    rec.calls, ['aaaa']);
  check('the click made after it is still owed', w.pending() === 1);
  await w.flush();
  eq('and goes out on the next send', rec.calls, ['aaaa', 'aaaaa']);
}

// --- nothing is lost when the popup closes ---------------------------------

{
  const clock = fakeTimers();
  const rec = recorder();
  const w = createTagWriter({ write: rec.write, delayMs: 600, timers: clock.timers });
  const r = w.push('ESG;Hide');
  await w.flush();
  eq('a flush sends the click waiting in the timer', rec.calls, ['ESG;Hide']);
  eq('and answers the click that was waiting on it', await r, true);
  check('a flush with nothing queued is harmless', (await w.flush(), rec.calls.length === 1));
}

// --- writes never overlap --------------------------------------------------

{
  const clock = fakeTimers();
  const order = [];
  let releaseFirst;
  const w = createTagWriter({
    delayMs: 100,
    timers: clock.timers,
    write: (v) => {
      order.push(`start:${v}`);
      if (v === 'first') return new Promise(res => { releaseFirst = () => { order.push('end:first'); res(true); }; });
      order.push(`end:${v}`);
      return true;
    },
  });
  w.push('first');
  await clock.advance(100);
  w.push('second');
  await clock.advance(100);
  eq('a second write waits for the first rather than racing it', order, ['start:first']);
  check('and the queue still owes both', w.pending() === 2);
  releaseFirst();
  await clock.settle();
  eq('the second goes out once the first has finished', order, ['start:first', 'end:first', 'start:second', 'end:second']);
}

// --- a refused write is reported, and doesn't block the next one ------------

{
  const clock = fakeTimers();
  const calls = [];
  const w = createTagWriter({
    delayMs: 100,
    timers: clock.timers,
    write: (v) => { calls.push(v); if (v === 'bad') return false; if (v === 'boom') throw new Error('HubSpot 500'); return true; },
  });
  const refused = w.push('bad');
  await clock.advance(100);
  eq('a write HubSpot refuses resolves false, so the tick can be rolled back', await refused, false);
  const threw = w.push('boom');
  await clock.advance(100);
  eq('a write that throws does too', await threw, false);
  const after = w.push('good');
  await clock.advance(100);
  eq('and the next click still goes out', await after, true);
  eq('every one of them was attempted', calls, ['bad', 'boom', 'good']);
}

// --- the pending flag the prop echo is judged against ----------------------

{
  const clock = fakeTimers();
  let release;
  const w = createTagWriter({
    delayMs: 600,
    timers: clock.timers,
    write: () => new Promise(res => { release = () => res(true); }),
  });
  check('idle owes nothing', w.pending() === 0);
  w.push('ESG');
  check('a click in the timer counts', w.pending() === 1);
  await clock.advance(600);
  check('and still counts once it is in the air — never a gap at zero', w.pending() === 1);
  release();
  await clock.settle();
  check('back to nothing when it lands', w.pending() === 0);
}

// --- the stale-echo guard --------------------------------------------------

eq('order and spelling do not change what a tag list says',
  tagListSignature('Efficiency / Renewables;ESG'), tagListSignature('esg;Efficiency/Renewables'));
eq('an empty list has an empty signature', tagListSignature('  ;; '), '');

const now = 1_000_000;
const writes = [
  { sig: tagListSignature('ESG'), at: now - 800 },
  { sig: tagListSignature('ESG;Procurement'), at: now - 200 },
];
check('the echo of the first click, arriving after the second was accepted, is stale',
  isStaleTagEcho({ incoming: 'ESG', saved: 'ESG;Procurement', writes, now }) === true);
check('the echo of the newest write is not stale — it says what we already hold',
  isStaleTagEcho({ incoming: 'ESG;Procurement', saved: 'ESG;Procurement', writes, now }) === false);
check('a list this editor never wrote is a real edit from elsewhere, not an echo',
  isStaleTagEcho({ incoming: 'ESG;Dan Key Target', saved: 'ESG;Procurement', writes, now }) === false);
check('a different spelling of the newest list is still not stale',
  isStaleTagEcho({ incoming: 'esg;procurement', saved: 'ESG;Procurement', writes, now }) === false);
check('an old write coming back long afterwards is somebody re-tagging for real',
  isStaleTagEcho({ incoming: 'ESG', saved: 'ESG;Procurement', writes, now: now + TAG_ECHO_WINDOW_MS + 1 }) === false);
check('with no writes of our own, nothing is an echo',
  isStaleTagEcho({ incoming: 'ESG', saved: 'ESG;Procurement', writes: [], now }) === false);
check('clearing the last tag is honoured rather than read as an echo',
  isStaleTagEcho({ incoming: '', saved: '', writes, now }) === false);

console.log(failures === 0 ? '\nAll tag write queue tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
