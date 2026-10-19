// The nightly backup carries the services board (which bucket each service
// is filed in, settings.customServiceCategories) and counts it, so a morning
// email flags services falling out of their buckets. Fourteen of ~150 fell
// onto "Other services" at once, a 9% drop that the general 10% threshold
// would have let through, so any drop in these counts is flagged. Plain Node:
//   node scripts/backupServiceBoard.test.mjs
import assert from 'node:assert/strict';
import { collectUserBackup, detectAnomalies, serviceBoardCounts } from '../api/_lib/dataBackup.js';

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
  async listDocuments() { return []; },
});
const db = {
  collection: (name) => colRef(name),
  collectionGroup: () => ({ async get() { return { forEach() {} }; } }),
};

const board = [
  { name: 'Traditional Energy Management', items: ['Strategic sourcing', 'Risk management', 'Rate optimization'] },
  { name: 'EU Compliance Reporting', items: ['CBAM', 'E.E.D.', ' cbam '] },
  { name: 'Old Graveyard', items: [] },
];
docs.set('userSettings/u1', { theme: 'x', customServiceCategories: board });

const { backup, summary } = await collectUserBackup(db, 'u1', 'someone@example.com');
assert.deepEqual(backup.collections.userSettings.customServiceCategories, board, 'the board is in the nightly snapshot');
assert.equal(summary.counts.serviceBuckets, 3, 'buckets counted, empty ones included');
assert.equal(summary.counts.servicesInBuckets, 5, 'filed services counted once each, case and spacing aside');

assert.deepEqual(serviceBoardCounts({ theme: 'x' }), {}, 'a board never saved (the seed) is not counted');

// Two services knocked out of their buckets on a 150-service board: under
// 10%, flagged anyway.
const alerts = detectAnomalies({ servicesInBuckets: 150, serviceBuckets: 20 }, { servicesInBuckets: 148, serviceBuckets: 20 });
assert.deepEqual(alerts.map(a => [a.field, a.prev, a.cur]), [['servicesInBuckets', 150, 148]]);
// A deleted bucket is flagged too.
assert.deepEqual(detectAnomalies({ serviceBuckets: 20 }, { serviceBuckets: 19 }).map(a => a.field), ['serviceBuckets']);
// Other counts keep the 10% threshold.
assert.deepEqual(detectAnomalies({ prospects: 1000 }, { prospects: 950 }), []);

console.log('backupServiceBoard: all assertions passed');
