// Pricing > Linked To > Earlier versions: a Linked To mapping wiped by a
// save comes back from the copy the cloud kept, and the restore itself is
// kept too, so it can be undone (utils/pricingMirroredKeys +
// utils/localMirrorSync).
//
// The real sync code runs against an in-memory Firestore and an in-memory
// IndexedDB (a loader hook swaps both in). Plain Node:
//   node scripts/pricingMappingRestore.test.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.window = new EventTarget();
if (typeof globalThis.CustomEvent === 'undefined') globalThis.CustomEvent = class extends Event {};

globalThis.__fakeFirestore = new Map();
globalThis.__fakeIdb = new Map();
const FAKE_FIRESTORE = `
  const docs = globalThis.__fakeFirestore;
  export const doc = (base, ...segs) => ({ path: [base && base.path, ...segs].filter(Boolean).join('/') });
  export const collection = (ref, name) => ({ path: ref.path + '/' + name });
  export async function getDoc(ref) { const d = docs.get(ref.path); return { exists: () => d !== undefined, data: () => d }; }
  export async function setDoc(ref, data, opts) { docs.set(ref.path, opts && opts.merge ? { ...(docs.get(ref.path) || {}), ...data } : { ...data }); }
  export async function getDocs() { return { forEach() {} }; }
  export function writeBatch() { return { set() {}, delete() {}, async commit() {} }; }
`;
const FAKE_DB = `
  const recs = globalThis.__fakeIdb;
  const k = (s, key) => s + '|' + key;
  export const getDbUserId = () => 'u1';
  export async function dbGet(s, key) { return recs.has(k(s, key)) ? structuredClone(recs.get(k(s, key))) : undefined; }
  export async function dbPut(s, value, key) { recs.set(k(s, key), structuredClone(value)); }
  export async function dbDelete(s, key) { recs.delete(k(s, key)); }
`;
const HOOKS = `
  export async function resolve(spec, ctx, next) {
    if (spec === 'firebase/firestore') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(FAKE_FIRESTORE)}), shortCircuit: true };
    if (spec === '../firebase.js' && ctx.parentURL && ctx.parentURL.includes('/src/utils/')) return { url: 'data:text/javascript,' + encodeURIComponent('export const db = { path: "" };'), shortCircuit: true };
    if (spec === './db.js' && ctx.parentURL && ctx.parentURL.includes('/src/utils/')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(FAKE_DB)}), shortCircuit: true };
    if (spec.startsWith('.') && !spec.split('/').pop().includes('.')) {
      try { return await next(spec + '.js', ctx); } catch { /* fall through */ }
    }
    return next(spec, ctx);
  }
`;
register('data:text/javascript,' + encodeURIComponent(HOOKS), import.meta.url);

const { setUserLsUserId, userLsSet } = await import('../src/utils/userLs.js');
const { setMirrorUserId, listMirrorVersions, readMirrorVersion, dbMirrorId } = await import('../src/utils/localMirrorSync.js');
const { PRICING_MIRROR_STORE, PRICING_MIRROR_EVENT, PRICING_MIRRORED_KEYS, PRICING_VERSION_CHOICES, queuePricingMirrorPush, restorePricingMirroredKey } = await import('../src/utils/pricingMirroredKeys.js');

setUserLsUserId('u1');
setMirrorUserId('u1');
const DB_KEY = 'linkedToDefaults';
const ID = dbMirrorId(PRICING_MIRROR_STORE, DB_KEY);
const cloudDoc = () => globalThis.__fakeFirestore.get(`userSettings/u1/localMirrors/${ID}`);
const cloud = () => JSON.parse(cloudDoc()?.json || 'null');
const local = () => globalThis.__fakeIdb.get(`${PRICING_MIRROR_STORE}|${DB_KEY}`);
const settle = () => new Promise(r => setTimeout(r, 1800)); // past the push debounce
let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); passed++; console.log(`PASS  ${name}`); };

ok(PRICING_VERSION_CHOICES.length === PRICING_MIRRORED_KEYS.length
  && PRICING_MIRRORED_KEYS.every(k => PRICING_VERSION_CHOICES.some(c => c.dbKey === k)), 'every Pricing mapping can be restored');
ok(PRICING_VERSION_CHOICES[0].dbKey === DB_KEY, 'the Linked To mapping is offered first');

// The mapping as it stood, synced.
const mapping = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`line ${i}::cts`, `Fee ${i}`]));
globalThis.__fakeFirestore.set(`userSettings/u1/localMirrors/${ID}`, { chunkCount: 0, updatedAt: 1000, json: JSON.stringify(mapping) });
globalThis.__fakeIdb.set(`${PRICING_MIRROR_STORE}|${DB_KEY}`, structuredClone(mapping));
userLsSet(`${ID}:__mirroredAt`, '1000');
userLsSet(`${ID}:__mirroredBase`, '1000');

// It gets wiped: the page saves an empty mapping.
globalThis.__fakeIdb.set(`${PRICING_MIRROR_STORE}|${DB_KEY}`, {});
queuePricingMirrorPush(DB_KEY);
await settle();
ok(Object.keys(cloud()).length === 0, 'the wipe reached the cloud (the loss being recovered from)');

const versions = await listMirrorVersions(ID);
ok(versions.length === 1 && versions[0].rows === 40 && versions[0].reason === 'before-delete', 'the 40-entry mapping was kept as an earlier version');

// Restore it, the way the Earlier versions popup does.
let reloaded = 0;
window.addEventListener(PRICING_MIRROR_EVENT, () => { reloaded++; });
const json = await readMirrorVersion(ID, versions[0].slot);
await restorePricingMirroredKey(DB_KEY, JSON.parse(json));
ok(Object.keys(local()).length === 40, 'restored in this browser');
ok(Object.keys(cloud()).length === 40, 'restored in the cloud, so other devices get it');
ok(reloaded === 1, 'an open Pricing page is told to re-read it');
const after = await listMirrorVersions(ID);
ok(after.length === 2 && after[0].reason === 'before-restore' && after[0].rows === 0, 'the copy the restore replaced is kept, so it can be undone');

await assert.rejects(() => restorePricingMirroredKey('notAKey', {}), /Not a Pricing mapping/);
passed++; console.log('PASS  only Pricing mappings can be restored this way');

console.log(`\n${passed} passed`);
