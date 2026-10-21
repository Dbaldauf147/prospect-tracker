// Services tagged to a contact category close it out once they are all
// Not Sold or N/A at a company (utils/bucketServices, utils/dmSteps).
// Plain Node. Run: node scripts/bucketServices.test.mjs
import assert from 'node:assert/strict';
import {
  isClosingStatus, servicesForBucket, bucketServiceState, closedBucketKeys,
  setServiceBucket, companyClosedBuckets, serviceBucketContext,
} from '../src/utils/bucketServices.js';
import { companyStepsRemaining, bucketStepsLeft } from '../src/utils/dmSteps.js';
import { BUCKETS } from '../src/components/ProspectModal/contactTags.js';
import { getEffectiveServiceMetadata } from '../src/data/serviceCatalog.js';

const proc = BUCKETS.find(b => b.key === 'procurement');
const esg = BUCKETS.find(b => b.key === 'esg');

assert.ok(isClosingStatus('Not Sold'));
assert.ok(isClosingStatus('N/A'));
assert.ok(!isClosingStatus('Sold'));
assert.ok(!isClosingStatus(''));
assert.ok(!isClosingStatus('-'));

const names = ['Alpha', 'Beta', 'Gamma'];
let ov = {};
ov = setServiceBucket(ov, 'Alpha', proc, true);
ov = setServiceBucket(ov, 'Beta', proc, true);
ov = setServiceBucket(ov, 'Beta', esg, true);
assert.equal(ov.Beta.contactTags, 'Procurement; ESG');
assert.equal(setServiceBucket(ov, 'Alpha', proc, true), ov, 'already tagged: same object');
// Tag matching ignores case and spacing, the way contacts' tags are read.
assert.deepEqual(servicesForBucket(proc, names, { ...ov, Gamma: { contactTags: 'procurement ' } }), ['Alpha', 'Beta', 'Gamma']);
assert.deepEqual(servicesForBucket(esg, names, ov), ['Beta']);

// Closed only when there is a service and every one is Not Sold or N/A.
const statuses = { Alpha: 'Not Sold', Beta: 'Quoting' };
const statusOf = n => statuses[n] || '';
assert.equal(bucketServiceState({ bucket: proc, serviceNames: names, overrides: ov, statusOf }).closed, false);
statuses.Beta = 'N/A';
assert.equal(bucketServiceState({ bucket: proc, serviceNames: names, overrides: ov, statusOf }).closed, true);
assert.deepEqual([...closedBucketKeys({ buckets: BUCKETS, serviceNames: names, overrides: ov, statusOf })].sort(), ['esg', 'procurement']);
const utilities = BUCKETS.find(b => b.key === 'utilities');
assert.equal(bucketServiceState({ bucket: utilities, serviceNames: names, overrides: ov, statusOf }).closed, false, 'no services: never closed this way');

// Untagging drops the field, then the row.
let ov2 = setServiceBucket(ov, 'Alpha', proc, false);
assert.ok(!('Alpha' in ov2));
ov2 = setServiceBucket(ov2, 'Beta', esg, false);
assert.equal(ov2.Beta.contactTags, 'Procurement');

// A closed category has no steps left, and companyStepsRemaining reads it.
assert.equal(bucketStepsLeft({ bucket: proc, hasYesDm: false, servicesClosed: true }), 0);
assert.equal(bucketStepsLeft({ bucket: proc, hasYesDm: false }), 5);
const r = companyStepsRemaining({ dms: [], record: {}, closedBuckets: new Set(['procurement']) });
const procRow = r.perBucket.find(b => b.bucket.key === 'procurement');
assert.equal(procRow.left, 0);
assert.equal(procRow.servicesClosed, true);
assert.equal(r.total, (BUCKETS.length - 1) * 5);
assert.equal(r.allDms, false, 'closed is not a decision maker');

// Away from the popup: manual statuses off the record and the real list.
const ctx = serviceBucketContext({});
const real = ctx.names[0];
assert.ok(real, 'the default service list has names');
const settingsOv = setServiceBucket({}, real, proc, true);
const ctx2 = { ...ctx, overrides: settingsOv };
assert.equal(getEffectiveServiceMetadata(real, settingsOv).contactTags.includes('Procurement'), true);
assert.ok(companyClosedBuckets({ servicesExplored: { [real]: 'Not Sold' } }, ctx2, BUCKETS).has('procurement'));
assert.ok(!companyClosedBuckets({ servicesExplored: { [real]: 'Sold' } }, ctx2, BUCKETS).has('procurement'));
assert.ok(!companyClosedBuckets({ servicesExplored: {} }, ctx2, BUCKETS).has('procurement'));

console.log('bucketServices: ok');
