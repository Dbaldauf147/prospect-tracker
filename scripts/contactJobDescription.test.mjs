import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_DESCRIPTION_NA, jobDescriptionFor, jobDescriptionUpdate } from '../src/utils/contactJobDescription.js';

test('reads a stored description, blank otherwise', () => {
  assert.equal(jobDescriptionFor({ 7: 'Leads energy procurement' }, 7), 'Leads energy procurement');
  assert.equal(jobDescriptionFor({}, 7), '');
  assert.equal(jobDescriptionFor(null, 7), '');
});

test('sets, marks N/A and clears one contact without touching the others', () => {
  const s0 = { contactJobDescriptions: { 1: 'Other contact' } };
  const s1 = { ...s0, ...jobDescriptionUpdate(2, 'Pasted text')(s0) };
  assert.deepEqual(s1.contactJobDescriptions, { 1: 'Other contact', 2: 'Pasted text' });
  const s2 = { ...s1, ...jobDescriptionUpdate(2, JOB_DESCRIPTION_NA)(s1) };
  assert.equal(s2.contactJobDescriptions[2], 'N/A');
  const s3 = { ...s2, ...jobDescriptionUpdate(2, '  ')(s2) };
  assert.deepEqual(s3.contactJobDescriptions, { 1: 'Other contact' });
});

test('no write when nothing changes or there is no id', () => {
  assert.equal(jobDescriptionUpdate(1, 'x')({ contactJobDescriptions: { 1: 'x' } }), null);
  assert.equal(jobDescriptionUpdate(1, '')({}), null);
  assert.equal(jobDescriptionUpdate(null, 'x')({}), null);
});
