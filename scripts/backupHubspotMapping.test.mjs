// The nightly backup carries the Hubspot Mapping page's own stores
// (lookupTables/{uid}/items/hubspot-mapping and hubspot-activity), counts
// them so a wipe trips the day-over-day alert, and the downloaded backup's
// restore puts them back without taking away anything added since.
// Plain Node:
//   node scripts/backupHubspotMapping.test.mjs
import assert from 'node:assert/strict';
import { collectUserBackup, detectAnomalies, hubspotLookupCounts } from '../api/_lib/dataBackup.js';
import { mergeHubspotMappingRestore, mergeHubspotActivityRestore, summarizeBackup, FULL_BACKUP_FORMAT } from '../src/utils/fullBackup.js';
import { mergeActivities } from '../src/utils/hubspotActivity.js';

// An in-memory stand-in for firebase-admin: path -> data.
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
    async listDocuments() { return []; },
  };
}
const db = {
  collection: (name) => colRef(name),
  collectionGroup: () => ({ async get() { return { forEach() {} }; } }),
};

const UID = 'u1';
const I = `lookupTables/${UID}/items`;
const mapping = {
  companies: [{ id: '1', name: 'Acme' }, { id: '2', name: 'Beta' }, { id: '3', name: 'Gamma' }],
  links: { a1: '1', a2: '2' },
  meta: { file: 'export.csv', at: '2026-11-01' },
};
put(`${I}/hubspot-mapping`, { chunkCount: 0, updatedAt: 1, json: JSON.stringify(mapping) });
// The activity history is big enough to be chunked: two slices under `s`.
const activity = {
  activities: [
    { companyId: '1', date: '2026-11-02', type: 'Email', engagementId: 'e1' },
    { companyId: '2', date: '2026-11-01', type: 'Call', engagementId: 'e2' },
  ],
  meta: { file: 'activity.csv' },
  ignored: ['x'],
};
const aj = JSON.stringify(activity);
put(`${I}/hubspot-activity`, { chunkCount: 2, updatedAt: 2, json: '' });
put(`${I}/hubspot-activity/chunks/0`, { s: aj.slice(0, 40) });
put(`${I}/hubspot-activity/chunks/1`, { s: aj.slice(40) });

const { backup, summary } = await collectUserBackup(db, UID, 'someone@example.com');
assert.deepEqual(backup.collections.lookupTables['hubspot-mapping'], mapping, 'the mapping and its links are in the backup');
assert.deepEqual(backup.collections.lookupTables['hubspot-activity'], activity, 'the chunked activity history is joined');
assert.ok(summary.captured.includes('lookupTables/hubspot-mapping'));
assert.ok(summary.captured.includes('lookupTables/hubspot-activity'));
assert.equal(summary.counts.hubspotMappingCompanies, 3);
assert.equal(summary.counts.hubspotMappingLinks, 2);
assert.equal(summary.counts.hubspotActivities, 2);
assert.equal(summary.counts.hubspotActivityIgnored, 1);
assert.deepEqual(summary.errors, []);

// A missing store still reports zero, so a wipe of the whole document alerts.
assert.deepEqual(hubspotLookupCounts('hubspot-mapping', null), { hubspotMappingCompanies: 0, hubspotMappingLinks: 0 });
const alerts = detectAnomalies({ hubspotMappingLinks: 300, hubspotActivities: 5000 }, { hubspotMappingLinks: 0, hubspotActivities: 5000 });
assert.deepEqual(alerts.map(a => [a.field, a.dropPct]), [['hubspotMappingLinks', 100]]);

// Restore of the mapping: current wins, the backup fills in the gaps.
const restoredMap = mergeHubspotMappingRestore(
  { companies: [{ id: '9', name: 'Newer' }], links: { a1: '9' }, meta: { file: 'newer.csv' } },
  mapping,
);
assert.deepEqual(restoredMap.companies, [{ id: '9', name: 'Newer' }], 'a newer export is kept');
assert.deepEqual(restoredMap.links, { a1: '9', a2: '2' }, 'lost links come back, a changed link stays changed');
assert.equal(restoredMap.meta.file, 'newer.csv');
const intoEmpty = mergeHubspotMappingRestore({ companies: [], links: {}, meta: {} }, mapping);
assert.deepEqual(intoEmpty, mapping, 'into a wiped store the backup comes back whole');

// Restore of the activity history: a union, nothing dropped.
const restoredAct = mergeHubspotActivityRestore(
  { activities: [{ companyId: '3', date: '2026-11-05', type: 'Meeting', engagementId: 'e3' }], meta: { file: 'new.csv' }, ignored: ['y'] },
  activity,
  mergeActivities,
);
assert.deepEqual(restoredAct.activities.map(a => a.engagementId), ['e3', 'e1', 'e2'], 'newest first, both sets kept');
assert.deepEqual(restoredAct.ignored.sort(), ['x', 'y']);
assert.equal(restoredAct.meta.file, 'new.csv');

// The restore confirmation counts them.
const s = summarizeBackup({ format: FULL_BACKUP_FORMAT, version: 1, firestore: { hubspotMapping: mapping, hubspotActivity: activity } });
assert.equal(s.hubspotMappingLinks, 2);
assert.equal(s.hubspotMappingCompanies, 3);
assert.equal(s.hubspotActivities, 2);

console.log('backupHubspotMapping: all assertions passed');
