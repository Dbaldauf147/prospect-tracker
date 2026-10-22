// Bulk edit on Dropdowns > Services (utils/serviceBulkEdit).
// Plain Node. Run: node scripts/serviceBulkEdit.test.mjs
import assert from 'node:assert/strict';
import { bulkServiceUpdates } from '../src/utils/serviceBulkEdit.js';
import { serviceBucketOf } from '../src/utils/serviceCategoriesStore.js';

const settings = {
  serviceOverrides: { A: { region: 'US' }, C: { sme: 'Kim' } },
  hiddenServices: ['C'],
  customServiceCategories: [{ name: 'One', items: ['A', 'B'] }, { name: 'Two', items: ['C'] }],
};

// A plain field: set on every name in one write, other fields kept.
const set = bulkServiceUpdates(settings, ['A', 'B', 'C'], 'region', ' EU ');
assert.deepEqual(set.serviceOverrides, { A: { region: 'EU' }, B: { region: 'EU' }, C: { sme: 'Kim', region: 'EU' } });
assert.deepEqual(settings.serviceOverrides.A, { region: 'US' }, 'settings are not mutated');

// Blank clears, and an override row left empty goes away.
assert.deepEqual(bulkServiceUpdates(settings, ['A', 'C'], 'region', '').serviceOverrides, { C: { sme: 'Kim' } });

// Nothing to change, or nothing to change it on: no write.
assert.equal(bulkServiceUpdates(settings, ['A'], 'region', 'US'), null);
assert.equal(bulkServiceUpdates(settings, [], 'region', 'EU'), null);
assert.equal(bulkServiceUpdates(settings, ['A'], 'nope', 'x'), null);

// Rollout time is a number of weeks.
assert.equal(bulkServiceUpdates(settings, ['A'], 'rolloutTime', 'soon'), null);
assert.equal(bulkServiceUpdates(settings, ['A'], 'rolloutTime', '06').serviceOverrides.A.rolloutTime, '6');

// Service Bucket moves every service on the board layout in one go.
const moved = bulkServiceUpdates(settings, ['A', 'C'], 'serviceBucket', 'Two').customServiceCategories;
assert.equal(serviceBucketOf(moved, 'A'), 'Two');
assert.equal(serviceBucketOf(moved, 'B'), 'One');
assert.equal(serviceBucketOf(moved, 'C'), 'Two');
assert.equal(bulkServiceUpdates(settings, ['C'], 'serviceBucket', 'Two'), null, 'already there');

// Hide / show.
assert.deepEqual(bulkServiceUpdates(settings, ['A', 'C'], 'hidden', 'Hidden').hiddenServices.sort(), ['A', 'C']);
assert.deepEqual(bulkServiceUpdates(settings, ['A', 'C'], 'hidden', 'Shown').hiddenServices, []);
assert.equal(bulkServiceUpdates(settings, ['C'], 'hidden', 'Hidden'), null);

console.log('serviceBulkEdit: all passed');
