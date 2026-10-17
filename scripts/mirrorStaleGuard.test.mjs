// A stale browser can never overwrite a synced store again, and every
// replacement keeps what it replaced (utils/localMirrorSync).
//
// The case this exists for: on Oct 16 2026 the Commissions roster was lost.
// Commissions synced whole-key, newest save wins, so a browser holding an
// out-of-date copy that saved even one cell replaced the roster everywhere.
// Now a save is only allowed over the cloud copy the browser last synced
// with; a stale one is refused, the browser takes the cloud copy, and its
// own unsaved copy is kept as an earlier version.
//
// The real commissions store and sync code run against an in-memory
// Firestore (a loader hook swaps it in). Plain Node:
//   node scripts/mirrorStaleGuard.test.mjs
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
const { setMirrorUserId, hydrateLocalMirrors, listMirrorVersions, readMirrorVersion, pushMirrorNow, removesData, MIRROR_CONFLICT_EVENT, VERSIONS_KEEP } = sync;
const { saveCommissionsOverride, clearCommissionsOverride, loadCommissions, restoreCommissions } = await import('../src/utils/commissionsStore.js');

const UID = 'u1';
setUserLsUserId(UID);
setMirrorUserId(UID);
const K = 'commissions-list-override';
const docPath = (id) => `userSettings/${UID}/localMirrors/${id}`;
const cloudDoc = (id) => globalThis.__fakeFirestore.get(docPath(id));
const cloud = () => JSON.parse(cloudDoc(K)?.json || 'null');
const putCloud = (value, updatedAt) => globalThis.__fakeFirestore.set(docPath(K), { chunkCount: 0, updatedAt, json: value === '' ? '' : JSON.stringify(value) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const settle = () => sleep(1800); // past the push debounce
const conflicts = [];
window.addEventListener(MIRROR_CONFLICT_EVENT, (e) => conflicts.push(e.detail));
const rows = (n, tag = 'r') => Array.from({ length: n }, (_, i) => ({ 'Account Name': `${tag}${i}`, January: i }));
// This browser as it stands right after syncing with a cloud copy stamped `at`.
function syncedWith(value, at) {
  userLsSet(K, JSON.stringify(value));
  userLsSet(K + ':__mirroredAt', String(at));
  userLsSet(K + ':__mirroredBase', String(at));
}
function reset() {
  for (const k of [...globalThis.__fakeFirestore.keys()]) globalThis.__fakeFirestore.delete(k);
  for (const k of [...Array(localStorage.length).keys()].map(i => localStorage.key(i)).filter(Boolean)) localStorage.removeItem(k);
  conflicts.length = 0;
}

// 1. In sync: an edit saves, and what it replaced is kept.
reset();
putCloud(rows(5), 1000);
syncedWith(rows(5), 1000);
saveCommissionsOverride([...rows(5), { 'Account Name': 'New', January: 9 }]);
await settle();
assert.equal(cloud().length, 6, 'an in-sync edit saves');
assert.equal(conflicts.length, 0);
let versions = await listMirrorVersions(K);
assert.equal(versions.length, 1);
assert.equal(versions[0].rows, 5, 'the replaced copy is kept');

// 2. THE BUG: another device saved since this browser last synced. This
// browser (still holding an old 3-row copy) edits one cell and saves.
reset();
putCloud(rows(120, 'full'), 2000);          // the real roster, saved elsewhere
syncedWith(rows(3, 'old'), 1000);            // this browser's stale copy
const stale = loadCommissions().data;
stale[0].January = 777;                      // "even one cell edit"
saveCommissionsOverride(stale);
await settle();
assert.equal(cloud().length, 120, 'the stale save is refused: the roster survives');
assert.equal(cloud()[0]['Account Name'], 'full0');
assert.equal(loadCommissions().data.length, 120, 'this browser takes the newer roster');
assert.equal(conflicts.length, 1, 'the page is told');
versions = await listMirrorVersions(K);
const notSaved = versions.find(v => v.reason === 'not-saved');
assert.ok(notSaved, "this browser's change is kept, not lost");
assert.equal(JSON.parse(await readMirrorVersion(K, notSaved.slot))[0].January, 777);

// 2b. And the next edit, now on the fresh copy, saves normally.
const fresh = loadCommissions().data;
fresh[1].January = 5;
saveCommissionsOverride(fresh);
await settle();
assert.equal(cloud()[1].January, 5);
assert.equal(cloud().length, 120);

// 3. A stale Clear is refused too.
reset();
putCloud(rows(40), 3000);
syncedWith(rows(40), 2000);
clearCommissionsOverride();
await settle();
assert.equal(cloud().length, 40, 'a stale clear is refused');

// 4. A deliberate Clear on an in-sync browser goes through, and keeps the roster.
reset();
putCloud(rows(40), 3000);
syncedWith(rows(40), 3000);
clearCommissionsOverride();
await settle();
assert.equal(cloudDoc(K).json, '', 'an in-sync clear clears');
versions = await listMirrorVersions(K);
assert.equal(versions[0].reason, 'before-delete');
assert.equal(JSON.parse(await readMirrorVersion(K, versions[0].slot)).length, 40, 'and the cleared roster is kept');

// 5. A browser from before the base was tracked (stamp only) behaves the same.
reset();
putCloud(rows(10), 5000);
userLsSet(K, JSON.stringify(rows(2)));
userLsSet(K + ':__mirroredAt', '4000');      // last synced at 4000, no base yet
saveCommissionsOverride(rows(2));
await settle();
assert.equal(cloud().length, 10, 'an old-format stale browser is refused');
reset();
putCloud(rows(10), 5000);
userLsSet(K, JSON.stringify(rows(10)));
userLsSet(K + ':__mirroredAt', '5000');
saveCommissionsOverride(rows(11));
await settle();
assert.equal(cloud().length, 11, 'an old-format in-sync browser saves');

// 6. Sign-in: the cloud is newer and this browser had an unsaved change.
reset();
putCloud(rows(50), 9000);
userLsSet(K, JSON.stringify(rows(3)));
userLsSet(K + ':__mirroredAt', '8000');      // edited after its last sync...
userLsSet(K + ':__mirroredBase', '7000');    // ...which was at 7000
await hydrateLocalMirrors(UID);
await sleep(50);
assert.equal(cloud().length, 50, 'sign-in never pushes a stale copy');
assert.equal(loadCommissions().data.length, 50, 'it takes the cloud copy');
assert.ok((await listMirrorVersions(K)).some(v => v.reason === 'not-saved' && v.rows === 3), 'and keeps its own');

// 7. Sign-in: this browser's stamp is newer than the cloud's but its base
// is older (the cloud moved on, then this browser edited). Refused.
reset();
putCloud(rows(60), 9000);
userLsSet(K, JSON.stringify(rows(1)));
userLsSet(K + ':__mirroredAt', '9500');
userLsSet(K + ':__mirroredBase', '8000');
await hydrateLocalMirrors(UID);
await settle();
assert.equal(cloud().length, 60, '"this browser is ahead" cannot push a stale copy');

// 8. A copy with no stamp at all never replaces the cloud's.
reset();
putCloud(rows(30), 9000);
userLsSet(K, JSON.stringify(rows(2)));
await hydrateLocalMirrors(UID);
await settle();
assert.equal(cloud().length, 30, 'unstamped local data does not overwrite');
assert.equal(loadCommissions().data.length, 30);

// 9. A deliberate restore (full backup) overrides, and keeps what it replaced.
reset();
putCloud(rows(8), 9000);
syncedWith(rows(4), 1000);
await pushMirrorNow(K);
assert.equal(cloud().length, 4, 'a restore is allowed to overwrite');
assert.equal((await listMirrorVersions(K))[0].reason, 'before-restore');

// 10. Routine edits keep at most one version per 10 minutes; deletions always do.
reset();
putCloud(rows(5), 1000);
syncedWith(rows(5), 1000);
for (let i = 0; i < 3; i++) {
  const d = loadCommissions().data; d[0].January = 100 + i;
  saveCommissionsOverride(d);
  await settle();
}
assert.equal((await listMirrorVersions(K)).length, 1, 'cell edits are throttled');
saveCommissionsOverride(rows(2));
await settle();
assert.equal((await listMirrorVersions(K))[0].reason, 'before-delete', 'a deletion always keeps a version');

// 11. Two saves close together from one browser don't trip over each other.
reset();
putCloud(rows(5), 1000);
syncedWith(rows(5), 1000);
saveCommissionsOverride(rows(6));
await settle();
const p1 = pushMirrorNow(K);
saveCommissionsOverride(rows(7));
await p1;
await settle();
assert.equal(cloud().length, 7, 'back-to-back saves from this browser both land');
assert.equal(conflicts.length, 0, 'and neither is taken for a conflict');

// 12. Restoring an earlier version keeps the roster it replaces, even
// inside the routine-edit throttle, so the restore can itself be undone.
reset();
putCloud(rows(5), 1000);
syncedWith(rows(5), 1000);
saveCommissionsOverride(rows(6));            // keeps the 5-row copy
await settle();
restoreCommissions(rows(5));                 // seconds later
await settle();
assert.equal(cloud().length, 5, 'the restore saves');
const kept = await listMirrorVersions(K);
assert.equal(kept[0].reason, 'before-restore');
assert.equal(kept[0].rows, 6, 'the roster the restore replaced is kept');

// The data-loss test, on its own.
assert.equal(removesData(JSON.stringify(rows(3)), JSON.stringify(rows(2))), true);
assert.equal(removesData(JSON.stringify(rows(3)), ''), true);
assert.equal(removesData(JSON.stringify(rows(3)), JSON.stringify(rows(4))), false);
assert.ok(VERSIONS_KEEP >= 20);

console.log('mirrorStaleGuard: all assertions passed');
process.exit(0);
