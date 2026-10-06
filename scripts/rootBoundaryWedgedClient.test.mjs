// The crash screen reloads a tab whose Firestore client died, once.
//
// A call into a crashed client (b815 wrapping ca9) that throws inside React
// lands on RootErrorBoundary. Nothing there can revive the client and the
// page is already unmounted, so the boundary reloads, but only once per
// five minutes so a page that crashes again on load can't loop.
//
// Run: node scripts/rootBoundaryWedgedClient.test.mjs
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
};

const { claimWedgedReload, isClientWedgedError } = await import('../src/utils/firestoreClientHealth.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const reported = new Error('FIRESTORE (12.18.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) CONTEXT: {"el":"Error: FIRESTORE (12.18.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9) CONTEXT: {\\"M\\":-1,\\"targetId\\":1836}"}');
ok(isClientWedgedError(reported), 'the reported b815/ca9 error is recognised as a crashed client');

const t0 = 1_000_000;
ok(claimWedgedReload(t0) === true, 'first crash: reload is claimed');
ok(claimWedgedReload(t0 + 1000) === false, 'second crash a second later: no reload (no loop)');
ok(claimWedgedReload(t0 + 299_999) === false, 'still inside the five-minute window: no reload');
ok(claimWedgedReload(t0 + 300_000) === true, 'after five minutes: reload is claimed again');

globalThis.sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
ok(claimWedgedReload(t0 + 900_000) === false, 'no sessionStorage: never auto-reloads (cannot tell a loop)');

const src = readFileSync(new URL('../src/components/RootErrorBoundary.jsx', import.meta.url), 'utf8');
ok(/isClientWedgedError\(error\)[\s\S]{0,200}claimWedgedReload\(\)[\s\S]{0,120}window\.location\.reload\(\)/.test(src),
  'RootErrorBoundary reloads on a crashed-client error only after claiming the cooldown');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
