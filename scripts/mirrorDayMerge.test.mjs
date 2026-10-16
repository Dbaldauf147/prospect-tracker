// The day-by-day chart histories merge row by row when they sync, instead
// of the newest copy replacing the cloud's whole (utils/localMirrorSync
// mergeDayHistories). The case this exists for: on Oct 15 2026 a tab left
// open since the 14th recorded the 16th onto its stale copy and pushed it,
// erasing the 15th from every Prospecting History chart.
//
// The push and hydration paths run for real against an in-memory stand-in
// for Firestore (a loader hook swaps it in), so this covers the code that
// actually talks to the cloud, not a copy of its rules. Plain Node:
//   node scripts/mirrorDayMerge.test.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';

// --- a browser enough for userLs and the change events --------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
  clear: () => store.clear(),
};
globalThis.window = new EventTarget();
globalThis.window.localStorage = globalThis.localStorage;
if (typeof globalThis.CustomEvent === 'undefined') globalThis.CustomEvent = class extends Event {};

// --- Firestore, in memory --------------------------------------------------
globalThis.__fakeFirestore = new Map();
const FAKE_FIRESTORE = `
  const docs = globalThis.__fakeFirestore;
  export const doc = (base, ...segs) => ({ path: [base && base.path, ...segs].filter(Boolean).join('/') });
  export const collection = (ref, name) => ({ path: ref.path + '/' + name });
  export async function getDoc(ref) {
    const d = docs.get(ref.path);
    return { exists: () => d !== undefined, data: () => d };
  }
  export async function setDoc(ref, data, opts) {
    docs.set(ref.path, opts && opts.merge ? { ...(docs.get(ref.path) || {}), ...data } : { ...data });
  }
  export async function getDocs() { return { forEach() {} }; }
  export function writeBatch() { return { set() {}, delete() {}, async commit() {} }; }
`;
const FAKE_APP = 'export const db = { path: "" };';
const HOOKS = `
  export async function resolve(spec, ctx, next) {
    if (spec === 'firebase/firestore') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(FAKE_FIRESTORE)}), shortCircuit: true };
    if (spec === '../firebase.js' && ctx.parentURL && ctx.parentURL.includes('/src/utils/')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(FAKE_APP)}), shortCircuit: true };
    // Vite resolves extensionless imports; Node needs the .js.
    if (spec.startsWith('.') && !spec.split('/').pop().includes('.')) {
      try { return await next(spec + '.js', ctx); } catch { /* fall through */ }
    }
    return next(spec, ctx);
  }
`;
register('data:text/javascript,' + encodeURIComponent(HOOKS), import.meta.url);

// Hydration imports every mirrored store; a few use Vite-only imports Node
// can't load. They are not what this test is about, so that one warning is
// dropped and everything else still prints.
const warn = console.warn;
console.warn = (...args) => { if (!String(args[0]).startsWith('localMirror: store registration import failed')) warn(...args); };

const { setUserLsUserId, userLsGet, userLsSet } = await import('../src/utils/userLs.js');
const sync = await import('../src/utils/localMirrorSync.js');
const { mergeDayHistories, registerMirroredKey, queueMirrorPush, setMirrorUserId, hydrateLocalMirrors } = sync;
const { ACTIVE_FIRMS_HISTORY_KEY } = await import('../src/utils/activeFirmsHistory.js');

// --- 1. the merge on its own -----------------------------------------------
{
  const local = { '2026-10-14': { v: 'L14', at: 5 }, '2026-10-16': { v: 'L16', at: 9 } };
  const remote = { '2026-10-14': { v: 'R14', at: 4 }, '2026-10-15': { v: 'R15', at: 7 } };
  const m = mergeDayHistories(local, remote);
  assert.deepEqual(Object.keys(m), ['2026-10-14', '2026-10-15', '2026-10-16'], 'every day either side has, in order');
  assert.equal(m['2026-10-14'].v, 'L14', 'the later stamp wins a day both have');
  assert.equal(mergeDayHistories({ d: { v: 'L', at: 1 } }, { d: { v: 'R', at: 2 } }).d.v, 'R');
  assert.equal(mergeDayHistories({ d: { v: 'L', at: 2 } }, { d: { v: 'R', at: 2 } }).d.v, 'L', 'a tie keeps this browser\'s');
  assert.equal(mergeDayHistories({ d: { v: 'L', updatedAt: 3 } }, { d: { v: 'R', at: 2 } }).d.v, 'L', 'updatedAt counts as a stamp');
  assert.deepEqual(mergeDayHistories(null, remote), remote);
  assert.deepEqual(mergeDayHistories(local, ''), local);

  // All Missing History's baseline moved on one machine (Oct 14 -> Oct 15):
  // the other machine's older copy still marks Oct 14. Only the newer stays.
  const moved = { '2026-10-14': { total: 9, updatedAt: 1 }, '2026-10-15': { total: 8, updatedAt: 2, baseline: true, frozenAt: 50 } };
  const old = { '2026-10-14': { total: 9, updatedAt: 1, baseline: true, frozenAt: 10 }, '2026-10-15': { total: 8, updatedAt: 2 } };
  for (const [a, b] of [[moved, old], [old, moved]]) {
    const r = mergeDayHistories(a, b);
    assert.equal(Object.keys(r).filter(k => r[k].baseline).join(), '2026-10-15', 'one baseline, the latest frozen');
    assert.equal('frozenAt' in r['2026-10-14'], false);
  }
}

// --- 2. the Oct 15 case through the real push ------------------------------
const UID = 'u1';
setUserLsUserId(UID);
setMirrorUserId(UID);
const cloudPath = (key) => `userSettings/${UID}/localMirrors/${key}`;
const cloud = (key) => JSON.parse(globalThis.__fakeFirestore.get(cloudPath(key))?.json || '{}');
const putCloud = (key, value, updatedAt) => globalThis.__fakeFirestore.set(cloudPath(key), { chunkCount: 0, updatedAt, json: JSON.stringify(value) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

{
  const K = ACTIVE_FIRMS_HISTORY_KEY;
  // Another machine recorded the 14th and 15th.
  putCloud(K, { '2026-10-14': { n: 85, at: 100 }, '2026-10-15': { n: 87, at: 200 } }, 200);
  // This tab has been open since the 14th: it only ever saw that day. Now it
  // records the 16th and pushes.
  userLsSet(K, JSON.stringify({ '2026-10-14': { n: 85, at: 100 }, '2026-10-16': { n: 90, at: 300 } }));
  let fired = 0;
  window.addEventListener('active-firms-history-changed', () => { fired += 1; });
  queueMirrorPush(K);
  await sleep(1800);
  assert.deepEqual(Object.keys(cloud(K)), ['2026-10-14', '2026-10-15', '2026-10-16'], 'the push keeps the 15th it never saw');
  assert.deepEqual(Object.keys(JSON.parse(userLsGet(K))), ['2026-10-14', '2026-10-15', '2026-10-16'], 'and this tab gets it back too');
  await sleep(10);
  assert.ok(fired >= 1, 'the chart is told to redraw');
}

// --- 3. hydration merges instead of replacing ------------------------------
{
  const K = 'test-day-history';
  registerMirroredKey(K, 'test-day-history-changed', { merge: mergeDayHistories });
  // The cloud copy is NEWER than this browser's, which used to mean it
  // replaced it outright and lost this browser's 16th.
  putCloud(K, { '2026-10-14': { at: 1 }, '2026-10-15': { at: 2 } }, 9999);
  userLsSet(K, JSON.stringify({ '2026-10-14': { at: 1 }, '2026-10-16': { at: 3 } }));
  userLsSet(K + ':__mirroredAt', '50');
  await hydrateLocalMirrors(UID);
  await sleep(50);
  assert.deepEqual(Object.keys(JSON.parse(userLsGet(K))), ['2026-10-14', '2026-10-15', '2026-10-16'], 'hydration keeps both sides');
  assert.deepEqual(Object.keys(cloud(K)), ['2026-10-14', '2026-10-15', '2026-10-16'], 'and sends the merge up');
}

// --- 4. other keys are untouched: still newest-wins ------------------------
{
  const K = 'test-plain-key';
  registerMirroredKey(K, 'test-plain-key-changed');
  putCloud(K, { a: 1 }, 10);
  userLsSet(K, JSON.stringify({ b: 2 }));
  queueMirrorPush(K);
  await sleep(1800);
  assert.deepEqual(cloud(K), { b: 2 }, 'a plain key still replaces the cloud copy');
}

console.log('mirrorDayMerge: all assertions passed');
process.exit(0);
