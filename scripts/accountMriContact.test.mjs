// Account MRI buying committee: which contact a stakeholder's Name opens.
//   node scripts/accountMriContact.test.mjs
import assert from 'node:assert/strict';
import { findCommitteeContact } from '../src/utils/accountMriContact.js';

const alex = { id: '1', firstname: 'Alex', lastname: 'Woolfson', email: 'alexander.woolfson@brookfield.com' };
const lisa = { id: '2', firstname: 'Lisa', lastname: 'Brylowski', email: 'lisa.brylowski@brookfield.com' };
const contacts = [alex, lisa];

assert.equal(findCommitteeContact(contacts, { name: 'Someone Else', email: 'ALEXANDER.Woolfson@brookfield.com ' }), alex, 'email wins');
assert.equal(findCommitteeContact(contacts, { name: '  lisa   brylowski ' }), lisa, 'name fallback');
assert.deepEqual(
  findCommitteeContact(contacts, { name: 'New Person Jr', email: 'np@x.com', title: 'CFO', phone: '555' }),
  { firstname: 'New', lastname: 'Person Jr', email: 'np@x.com', jobtitle: 'CFO', phone: '555' },
  'unmatched row builds a minimal record',
);
assert.equal(findCommitteeContact(null, { name: 'A B' }).firstname, 'A', 'no contacts loaded');
console.log('accountMriContact: 4 passed');
