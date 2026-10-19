// The nightly backup carries the Opps To do list (its cloud copy,
// localMirrors/opps2:todo) and counts its items, so a wiped list trips the
// morning email's data-loss alert. Ticking items off shrinks it every day,
// so only a drop of half or more is flagged. Plain Node:
//   node scripts/backupOppsTodo.test.mjs
import assert from 'node:assert/strict';
import { collectUserBackup, detectAnomalies, todoItemCount } from '../api/_lib/dataBackup.js';

const docs = new Map();
const docRef = (path) => ({
  id: path.split('/').pop(),
  path,
  async get() { const d = docs.get(path); return { exists: d !== undefined, data: () => d }; },
  collection: (name) => colRef(`${path}/${name}`),
});
const colRef = (path) => ({
  doc: (id) => docRef(`${path}/${id}`),
  async get() { return { size: 0, docs: [], forEach() {} }; },
  async listDocuments() {
    const ids = new Set();
    for (const k of docs.keys()) if (k.startsWith(path + '/')) ids.add(k.slice(path.length + 1).split('/')[0]);
    return [...ids].map(id => docRef(`${path}/${id}`));
  },
});
const db = {
  collection: (name) => colRef(name),
  collectionGroup: () => ({ async get() { return { forEach() {} }; } }),
};

const LIST = '• Call Acme about the renewal\n• Send Globex the quote\n  continued on a second line\n• ';
docs.set('userSettings/u1', { theme: 'x' });
docs.set('userSettings/u1/localMirrors/opps2:todo', { chunkCount: 0, updatedAt: 5, json: LIST });

{
  const { backup, summary } = await collectUserBackup(db, 'u1', 'someone@example.com');
  assert.equal(backup.collections.localMirrors['opps2:todo']._unparseableJson, LIST, 'the list text is in the nightly snapshot');
  assert.equal(summary.counts.oppsTodoItems, 3, 'non-blank lines counted; an empty trailing bullet is not');
}

// A list cleared to nothing, or with no cloud copy at all, still reports 0,
// so the drop is seen.
docs.set('userSettings/u1/localMirrors/opps2:todo', { chunkCount: 0, updatedAt: 6, json: '' });
assert.equal((await collectUserBackup(db, 'u1', '')).summary.counts.oppsTodoItems, 0);
docs.delete('userSettings/u1/localMirrors/opps2:todo');
assert.equal((await collectUserBackup(db, 'u1', '')).summary.counts.oppsTodoItems, 0);

assert.equal(todoItemCount('• a\n• b'), 2, 'a plain string is read too');
assert.equal(todoItemCount(null), 0);

const fields = (prev, cur) => detectAnomalies({ oppsTodoItems: prev }, { oppsTodoItems: cur }).map(a => a.field);
assert.deepEqual(fields(12, 0), ['oppsTodoItems'], 'a wipe is flagged');
assert.deepEqual(fields(12, 6), ['oppsTodoItems'], 'half gone is flagged');
assert.deepEqual(fields(12, 10), [], 'a couple ticked off is not');

console.log('backupOppsTodo: all assertions passed');
