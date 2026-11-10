// The nightly backup carries the Commissions tab's settings (BFO popup OK
// marks, uploaded months, table layouts) with the rest of the settings and
// counts them, so the morning email flags them if they are wiped. Plain Node:
//   node scripts/backupCommissionSettings.test.mjs
import assert from 'node:assert/strict';
import { collectUserBackup, detectAnomalies, commissionSettingsCounts } from '../api/_lib/dataBackup.js';

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

const marks = {
  'sb - sus - willco': { 'revenue:recurring:2025-11': '0|3155', 'revenue:total:2025-11': '0|3155' },
  'other opp': { 'commission:total:total': '100|120' },
  'cleared opp': {},
};
const uploads = { '2026-09': { fileName: 'Sep.xlsx', at: '2026-10-02T00:00:00Z' }, '2026-10': { fileName: 'Oct.xlsx', at: '2026-11-02T00:00:00Z' } };
const tablePrefs = { commissions: { widths: {} }, 'commissions-monthly': {}, 'commissions-projected': {}, 'deals-table': {} };
docs.set('userSettings/u1', { theme: 'x', commissionBfoOk: marks, commissionMonthUploads: uploads, tablePrefs });

const { backup, summary } = await collectUserBackup(db, 'u1', 'someone@example.com');
const s = backup.collections.userSettings;
assert.deepEqual([s.commissionBfoOk, s.commissionMonthUploads, s.tablePrefs], [marks, uploads, tablePrefs], 'commission settings are in the nightly snapshot');
assert.equal(summary.counts.commissionBfoOkMarks, 3, 'OK marks counted across opps');
assert.equal(summary.counts.commissionBfoOkOpps, 2, 'opps with marks counted, empty ones not');
assert.equal(summary.counts.commissionMonthUploads, 2, 'uploaded months counted');
assert.equal(summary.counts.commissionTableLayouts, 3, 'only the Commissions table layouts counted');

assert.deepEqual(commissionSettingsCounts({ theme: 'x' }), {}, 'nothing saved, nothing counted');
assert.equal(commissionSettingsCounts({ commissionBfoOk: JSON.stringify(marks) }).commissionBfoOkMarks, 3, 'a JSON-string map is read too');

const fields = (prev, cur) => detectAnomalies(prev, cur).map(a => a.field);
assert.deepEqual(fields({ commissionBfoOkMarks: 40 }, { commissionBfoOkMarks: 0 }), ['commissionBfoOkMarks'], 'wiped OK marks alert');
assert.deepEqual(fields({ commissionBfoOkMarks: 40 }, { commissionBfoOkMarks: 35 }), [], 'a few marks lapsing does not');
assert.deepEqual(fields({ commissionMonthUploads: 12 }, { commissionMonthUploads: 11 }), ['commissionMonthUploads'], 'any lost upload record alerts');
assert.deepEqual(fields({ commissionTableLayouts: 3 }, { commissionTableLayouts: 2 }), ['commissionTableLayouts'], 'a lost table layout alerts');

console.log('backupCommissionSettings: all passed');
