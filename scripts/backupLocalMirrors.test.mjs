// The nightly backup carries the browser stores mirrored to Firestore
// (userSettings/{uid}/localMirrors), the only cloud copy of the
// Commissions roster among others, and counts the list-shaped ones so a
// wipe trips the day-over-day alert. Runs the real collectUserBackup over
// an in-memory stand-in for firebase-admin. Plain Node:
//   node scripts/backupLocalMirrors.test.mjs
import assert from 'node:assert/strict';
import { collectUserBackup, detectAnomalies, isMirrorVersionId } from '../api/_lib/dataBackup.js';

// path -> data, for documents; a collection is every doc one level under it.
const docs = new Map();
const put = (path, data) => docs.set(path, data);
function docRef(path) {
  return {
    id: path.split('/').pop(),
    path,
    async get() { const d = docs.get(path); return { exists: d !== undefined, data: () => d, id: path.split('/').pop() }; },
    collection: (name) => colRef(`${path}/${name}`),
  };
}
function colRef(path) {
  const children = () => [...docs.keys()].filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));
  return {
    doc: (id) => docRef(`${path}/${id}`),
    async get() {
      const list = children().map(k => ({ id: k.split('/').pop(), ref: docRef(k), data: () => docs.get(k) }));
      return { size: list.length, docs: list, forEach: (fn) => list.forEach(fn) };
    },
    async listDocuments() {
      // Like firebase-admin: documents with data OR with subcollections.
      const ids = new Set();
      for (const k of docs.keys()) if (k.startsWith(path + '/')) ids.add(k.slice(path.length + 1).split('/')[0]);
      return [...ids].map(id => docRef(`${path}/${id}`));
    },
  };
}
const db = {
  collection: (name) => colRef(name),
  collectionGroup: () => ({ async get() { return { forEach() {} }; } }),
};

const UID = 'u1';
const M = `userSettings/${UID}/localMirrors`;
put(`userSettings/${UID}`, { theme: 'x' });
const roster = [{ 'Account Name': 'Acme', January: 100 }, { 'Account Name': 'Beta', January: 50 }];
put(`${M}/commissions-list-override`, { chunkCount: 0, updatedAt: 5, json: JSON.stringify(roster) });
// A chunked one: two slices under `s`.
const big = JSON.stringify({ '2026-10-16': { at: 1 } });
put(`${M}/active-firms-history`, { chunkCount: 2, updatedAt: 6, json: '' });
put(`${M}/active-firms-history/chunks/0`, { s: big.slice(0, 10) });
put(`${M}/active-firms-history/chunks/1`, { s: big.slice(10) });
put(`${M}/broken`, { chunkCount: 0, updatedAt: 1, json: '{not json' });
put(`${M}/commissions-list-override__v1`, { chunkCount: 0, updatedAt: 4, json: JSON.stringify([roster[0]]) });

const { backup, summary } = await collectUserBackup(db, UID, 'someone@example.com');
const lm = backup.collections.localMirrors;
assert.deepEqual(lm['commissions-list-override'], roster, 'the commissions roster is in the backup');
assert.deepEqual(lm['active-firms-history'], { '2026-10-16': { at: 1 } }, 'a chunked mirror is joined');
assert.deepEqual(lm.broken, { _unparseableJson: '{not json' }, 'unparseable text is kept, not dropped');
assert.ok(summary.captured.includes('localMirrors'));
assert.equal(summary.counts['commissions-list-override rows'], 2, 'list-shaped stores are counted');
assert.equal('commissions-list-override__v1 rows' in summary.counts, false, 'saved versions are not counted as stores');
assert.equal(summary.counts.localMirrors, 4);
assert.deepEqual(summary.errors, []);

// A roster wiped overnight trips the urgent alert.
const alerts = detectAnomalies({ 'commissions-list-override rows': 120 }, { 'commissions-list-override rows': 0 });
assert.deepEqual(alerts.map(a => [a.field, a.dropPct]), [['commissions-list-override rows', 100]]);

assert.equal(isMirrorVersionId('commissions-list-override__v12'), true);
assert.equal(isMirrorVersionId('commissions-list-override__versions'), true);
assert.equal(isMirrorVersionId('commissions-list-override'), false);

console.log('backupLocalMirrors: all assertions passed');
