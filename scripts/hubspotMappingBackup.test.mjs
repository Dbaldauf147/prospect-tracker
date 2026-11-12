// The Hubspot Mapping page's backup bar: the file it downloads, the three
// backup shapes its restore reads, and the additive restore plan.
// Plain Node:
//   node scripts/hubspotMappingBackup.test.mjs
import assert from 'node:assert/strict';
import { buildHubspotBackupFile, hubspotBackupFileName, readHubspotBackup, planHubspotRestore, HUBSPOT_BACKUP_FORMAT } from '../src/utils/hubspotMappingBackup.js';
import { FULL_BACKUP_FORMAT } from '../src/utils/fullBackup.js';

const mapping = { companies: [{ id: '1', name: 'Acme' }, { id: '2', name: 'Beta' }], links: { a1: '1', a2: '2' }, meta: { file: 'x.csv' } };
const activity = {
  activities: [
    { companyId: '1', date: '2026-11-02', type: 'Email', engagementId: 'e1' },
    { companyId: '2', date: '2026-11-01', type: 'Call', engagementId: 'e2' },
  ],
  meta: {}, ignored: ['k1'],
};

// The downloaded file reads back as itself.
const now = new Date(2026, 10, 12, 9, 5);
const file = buildHubspotBackupFile({ mapping, activity, now });
assert.equal(file.format, HUBSPOT_BACKUP_FORMAT);
assert.equal(hubspotBackupFileName(now), 'hubspot-mapping-backup-2026-11-12.json');
const fromFile = readHubspotBackup(JSON.parse(JSON.stringify(file)));
assert.deepEqual(fromFile.mapping, mapping);
assert.deepEqual(fromFile.activity, activity);

// The Backups page's full backup.
const full = readHubspotBackup({ format: FULL_BACKUP_FORMAT, version: 1, createdAt: now.getTime(), firestore: { hubspotMapping: mapping } });
assert.deepEqual(full.mapping, mapping);
assert.equal(full.activity, null);
assert.equal(readHubspotBackup({ format: FULL_BACKUP_FORMAT, version: 1, firestore: {} }), null, 'an older full backup without them');

// A nightly snapshot, whole and as backup-fetch's part=lookupTables value.
const nightly = { generatedAt: '2026-11-12T08:00:00Z', collections: { lookupTables: { 'hubspot-mapping': mapping, 'hubspot-activity': activity } } };
assert.deepEqual(readHubspotBackup(nightly).activity, activity);
assert.equal(readHubspotBackup(nightly).createdAt, '2026-11-12T08:00:00Z');
assert.deepEqual(readHubspotBackup({ 'hubspot-mapping': mapping, 'hubspot-activity': null }).mapping, mapping);
assert.equal(readHubspotBackup({ collections: { userSettings: {} } }), null, 'a snapshot from before they were backed up');
assert.equal(readHubspotBackup({ collections: { lookupTables: { 'hubspot-mapping': null, 'hubspot-activity': null } } }), null);
assert.equal(readHubspotBackup('nope'), null);
assert.equal(readHubspotBackup({ random: 1 }), null);

// Restore plan: links and activities lost since come back, nothing current changes.
const current = {
  mapping: { companies: [{ id: '9', name: 'Newer' }], links: { a1: '9' }, meta: { file: 'new.csv' } },
  activity: { activities: [{ companyId: '1', date: '2026-11-02', type: 'Email', engagementId: 'e1', subject: 'newer' }], meta: {}, ignored: [] },
};
const plan = planHubspotRestore(current, fromFile);
assert.equal(plan.linksAdded, 1);
assert.deepEqual(plan.mapping.links, { a1: '9', a2: '2' }, 'a changed link stays changed');
assert.equal(plan.exportRestored, false);
assert.deepEqual(plan.mapping.companies, current.mapping.companies);
assert.equal(plan.activitiesAdded, 1);
assert.equal(plan.activity.activities.find(a => a.engagementId === 'e1').subject, 'newer', 'the current copy of an activity wins');
assert.equal(plan.ignoredAdded, 1);
assert.equal(plan.changes, 3);

// Into a wiped page, everything comes back.
const wiped = planHubspotRestore({ mapping: { companies: [], links: {}, meta: {} }, activity: { activities: [], meta: {} } }, fromFile);
assert.equal(wiped.exportRestored, true);
assert.equal(wiped.linksAdded, 2);
assert.equal(wiped.activitiesAdded, 2);
assert.deepEqual(wiped.mapping, mapping);

// Restoring what's already here changes nothing.
const same = planHubspotRestore({ mapping, activity }, fromFile);
assert.equal(same.changes, 0);

// A backup with only one store leaves the other alone.
const onlyMap = planHubspotRestore(current, { mapping, activity: null });
assert.equal(onlyMap.activity, null);

console.log('hubspotMappingBackup: all assertions passed');
