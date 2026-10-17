// Recovering a lost mirrored store from Firestore point-in-time recovery
// (api/_lib/mirrorRecover). The case it was written for: the Commissions
// roster overwritten, no backup holding it. Runs the real recoverMirror
// over an in-memory Firestore that keeps each document's history. Plain
// Node:  node scripts/mirrorRecover.test.mjs
import assert from 'node:assert/strict';
import { recoverMirror, isTooOldError } from '../api/_lib/mirrorRecover.js';

const H = 3600000;
const NOW = Date.UTC(2026, 9, 17, 17, 0, 0);

// path -> [{ from: ms, data }] (data null = deleted), oldest first.
function makeDb({ pitr }) {
  const history = new Map();
  const at = (path, ms) => {
    const list = history.get(path) || [];
    let d;
    for (const v of list) if (v.from <= ms) d = v.data;
    return d ?? undefined;
  };
  const write = (path, data, from = NOW) => {
    const list = history.get(path) || [];
    list.push({ from, data }); history.set(path, list);
  };
  const now = (path) => at(path, Number.MAX_SAFE_INTEGER);
  const docRef = (path) => ({
    id: path.split('/').pop(), path,
    collection: (n) => colRef(`${path}/${n}`),
    async get() { const d = now(path); return { exists: d != null, data: () => d }; },
    async set(data, opts) { write(path, opts?.merge ? { ...(now(path) || {}), ...data } : data); },
  });
  const colRef = (path) => ({ path, doc: (id) => docRef(`${path}/${id}`) });
  const db = {
    history, write,
    collection: (n) => colRef(n),
    batch() { const ops = []; return { set: (r, d, o) => ops.push(() => r.set(d, o)), async commit() { for (const f of ops) await f(); } }; },
    async runTransaction(fn, opts) {
      const ms = opts.readTime.getTime();
      if (!pitr && ms < NOW - H) { const e = new Error('The read_time is too old; enable point-in-time recovery'); e.code = 9; throw e; }
      const t = {
        async get(ref) {
          if (ref.doc) { // a collection: its child docs as of then
            const kids = [...history.keys()].filter(k => k.startsWith(ref.path + '/') && !k.slice(ref.path.length + 1).includes('/'));
            const docs = kids.map(k => ({ id: k.split('/').pop(), data: () => at(k, ms) })).filter(d => d.data() != null);
            return { forEach: (f) => docs.forEach(f) };
          }
          const d = at(ref.path, ms);
          return { exists: d != null, data: () => d };
        },
      };
      return fn(t);
    },
  };
  return db;
}

const UID = 'u1';
const P = `userSettings/${UID}/localMirrors/commissions-list-override`;
const roster = (n, tag = 'r') => JSON.stringify(Array.from({ length: n }, (_, i) => ({ 'Account Name': `${tag}${i}`, January: i })));

// The history: the full roster from 6 days ago, overwritten 30 hours ago.
function seed(db) {
  db.write(P, { chunkCount: 0, updatedAt: 1, json: roster(118) }, NOW - 144 * H);
  db.write(P, { chunkCount: 0, updatedAt: 2, json: roster(120) }, NOW - 100 * H);
  db.write(P, { chunkCount: 0, updatedAt: 3, json: roster(3, 'stale') }, NOW - 30 * H);
}

// 1. PITR off: said so, nothing written.
{
  const db = makeDb({ pitr: false });
  seed(db);
  const r = await recoverMirror(db, UID, 'commissions-list-override', { now: NOW });
  assert.equal(r.pitr, false);
  assert.equal(r.added, 0);
  assert.equal(db.history.has(`${P}__versions`), false, 'nothing written without PITR');
}

// 2. PITR on: every distinct copy is found, newest first, and filed.
{
  const db = makeDb({ pitr: true });
  seed(db);
  const r = await recoverMirror(db, UID, 'commissions-list-override', { now: NOW });
  assert.equal(r.pitr, true);
  assert.deepEqual(r.found.map(f => f.rows), [3, 120, 118], 'the overwritten roster is found');
  assert.equal(r.added, 3);
  const idxDoc = await db.collection('userSettings').doc(UID).collection('localMirrors').doc('commissions-list-override__versions').get();
  const idx = JSON.parse(idxDoc.data().json);
  assert.deepEqual(idx.list.map(v => [v.rows, v.reason]), [[3, 'recovered'], [120, 'recovered'], [118, 'recovered']], 'filed newest on top');
  const slot120 = idx.list.find(v => v.rows === 120).slot;
  const v = await db.collection('userSettings').doc(UID).collection('localMirrors').doc(`commissions-list-override__v${slot120}`).get();
  assert.equal(JSON.parse(v.data().json).length, 120, 'in the format the app reads versions in');
  assert.ok(idx.list.find(x => x.rows === 120).archivedAt <= NOW - 31 * H, 'dated when it was the live copy');

  // Running it again files nothing twice.
  const again = await recoverMirror(db, UID, 'commissions-list-override', { now: NOW });
  assert.equal(again.added, 0);
}

// 3. A chunked roster is joined back together.
{
  const db = makeDb({ pitr: true });
  const big = roster(4000);
  const parts = [big.slice(0, 100000), big.slice(100000)];
  db.write(P, { chunkCount: 2, updatedAt: 1, json: '' }, NOW - 50 * H);
  db.write(`${P}/chunks/0`, { s: parts[0] }, NOW - 50 * H);
  db.write(`${P}/chunks/1`, { s: parts[1] }, NOW - 50 * H);
  db.write(P, { chunkCount: 0, updatedAt: 2, json: '[]' }, NOW - 10 * H);
  const r = await recoverMirror(db, UID, 'commissions-list-override', { now: NOW });
  assert.ok(r.found.some(f => f.rows === 4000), 'a chunked copy is read whole');
}

// 4. The too-old check only matches the read-time refusal.
assert.equal(isTooOldError({ code: 9, message: 'read_time is too old' }), true);
assert.equal(isTooOldError({ code: 'FAILED_PRECONDITION', message: 'Read time older than version retention period' }), true);
assert.equal(isTooOldError({ code: 7, message: 'permission denied' }), false);
assert.equal(isTooOldError({ code: 9, message: 'index not ready' }), false);

console.log('mirrorRecover: all assertions passed');
