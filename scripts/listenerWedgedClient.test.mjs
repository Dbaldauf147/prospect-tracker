// A crashed Firestore client must not take the page down through a listener.
//
// After the SDK's async queue fails (ca9, then b815 on everything), both
// onSnapshot() and its unsubscribe throw synchronously. The unsubscribe runs
// in a React effect cleanup, so that throw reached the root error boundary
// and replaced the whole app with "Something in the page crashed".
// guardListener swallows exactly that family, records the crash, and leaves
// every other error alone.
//
// Run: node scripts/listenerWedgedClient.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const health = await import('../src/utils/firestoreClientHealth.js');
const { guardListener, isClientWedged, __resetClientHealth } = health;

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}
const b815 = () => new Error('FIRESTORE (12.18.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) CONTEXT: {"el":"... (ID: ca9) ..."}');
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// Healthy client: subscribe runs, unsubscribe passes through.
__resetClientHealth();
{
  let subscribed = 0, unsubscribed = 0;
  const unsub = guardListener(() => { subscribed++; return () => { unsubscribed++; }; });
  unsub();
  ok(subscribed === 1 && unsubscribed === 1, 'healthy client: subscribes and unsubscribes normally');
  ok(!isClientWedged(), 'healthy client: not marked crashed');
}

// The reported crash: the client dies while the listener is open, and the
// effect cleanup's unsubscribe throws b815.
__resetClientHealth();
{
  const unsub = guardListener(() => () => { throw b815(); });
  ok(throws(unsub) === null, 'unsubscribe on a crashed client does not throw');
  ok(isClientWedged(), 'unsubscribe on a crashed client marks it crashed');
}

// Subscribing on a crashed client (a view mounting after the crash).
__resetClientHealth();
{
  let unsub;
  ok(throws(() => { unsub = guardListener(() => { throw b815(); }); }) === null, 'subscribe on a crashed client does not throw');
  ok(typeof unsub === 'function' && throws(unsub) === null, 'subscribe on a crashed client returns a working no-op');
  ok(isClientWedged(), 'subscribe on a crashed client marks it crashed');
  let called = false;
  guardListener(() => { called = true; return () => {}; });
  ok(!called, 'once known crashed, later listeners skip the SDK entirely');
}

// Anything else is a real bug and must still surface.
__resetClientHealth();
{
  const bad = new Error('Missing or insufficient permissions.');
  ok(throws(() => guardListener(() => { throw bad; })) === bad, 'other subscribe errors still throw');
  const unsub = guardListener(() => () => { throw bad; });
  ok(throws(unsub) === bad, 'other unsubscribe errors still throw');
  ok(!isClientWedged(), 'other errors do not mark the client crashed');
}

// Every listener goes through the guard: nothing in src/ may take
// onSnapshot straight from the SDK except the wrapper itself.
{
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|mjs)$/.test(name) || p.endsWith('safeOnSnapshot.js')) continue;
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]firebase\/firestore['"]/g)) {
        if (/\bonSnapshot\b/.test(m[1])) offenders.push(p);
      }
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  ok(offenders.length === 0, `onSnapshot only imported via safeOnSnapshot${offenders.length ? ': ' + offenders.join(', ') : ''}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
