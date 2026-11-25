// withContactLocalFields: the local contact fields laid over the HubSpot
// cache the way App.jsx does, so the Account MRI sees a pinned contact.
//   node scripts/contactLocalFields.test.mjs
import assert from 'node:assert/strict';
import { withContactLocalFields } from '../src/utils/contactCompanyOverride.js';
import { companyRosterContacts } from '../src/utils/companyRoster.js';
import { accountMriProfile } from '../src/utils/accountMri.js';

const lori = { id: '7', firstname: 'Lori', lastname: 'Butler', email: 'lbutler@cdr.com', company: 'CD and R Holdings', dans_tags: 'ESG;Primary Point of Contact' };
const other = { id: '8', firstname: 'A', lastname: 'B', company: 'X' };
const local = { 7: { _companyOverride: 'Clayton, Dubilier & Rice (CD&R)', nickname: 'Lo' } };
const record = { company: 'Clayton, Dubilier & Rice (CD&R)' };

const merged = withContactLocalFields([lori, other], local);
assert.equal(merged[0].company, 'Clayton, Dubilier & Rice (CD&R)', 'pin wins');
assert.equal(merged[0].nickname, 'Lo', 'other local fields come along');
assert.equal(merged[1], other, 'untouched contact kept as is');
assert.equal(lori.company, 'CD and R Holdings', 'input not mutated');

const list = [lori];
assert.equal(withContactLocalFields(list, {}), list, 'nothing local: same list');
assert.equal(withContactLocalFields(list, null), list, 'no settings: same list');

// Without the pin the raw sync leaves her off the account; with it she is
// its Main point of contact.
assert.equal(companyRosterContacts([lori], record).length, 0);
const contacts = companyRosterContacts(merged, record);
assert.equal(accountMriProfile({ record, contacts }).mainContact, 'Lori Butler · lbutler@cdr.com');
console.log('contactLocalFields: 8 passed');
