// Prospecting > DMs Without Activity: the Decision Makers roster (the one
// the History chart counts) with no outreach ever, or none in a window,
// and the account each is paired with. Plain Node:
//   node scripts/dmsWithoutActivity.test.mjs
import assert from 'node:assert/strict';
import { decisionMakersWithoutActivity } from '../src/utils/tieredAccountActivity.js';
import { makeMyCdmContactAccount, makeMyCdmContactGate } from '../src/utils/myCdmContacts.js';

const DAY = 86400000;
const now = Date.UTC(2026, 10, 12, 12);
const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();

const prospects = [
  { id: 'p1', company: 'Acme', cdm: 'Dan Baldauf', emailDomain: 'acme.com' },
  { id: 'p2', company: 'Beta', cdm: 'Someone Else' },
];
const dm = (id, first, extra = {}) => ({ id, firstname: first, lastname: 'X', company: 'Acme', email: `${first.toLowerCase()}@acme.com`, dans_tags: 'Decision Maker', ...extra });
const contacts = [
  dm('1', 'Never'),                                            // no activity at all
  dm('2', 'Old', { notes_last_contacted: iso(200) }),         // last touched 200 days ago
  dm('3', 'Recent', { notes_last_contacted: iso(10) }),       // touched 10 days ago
  dm('4', 'Emailed'),                                          // emailed via the outreach index
  dm('5', 'Called', { phone: '(212) 555-0100' }),             // called via the outreach index
  dm('6', 'Hidden', { dans_tags: 'Decision Maker;Hide' }),    // hidden: not on the roster
  dm('7', 'Gone', { dans_tags: 'Decision Maker;Left' }),      // left: not on the roster
  dm('8', 'Other', { company: 'Beta', email: 'o@beta.com' }), // another CDM's account
  { id: '9', firstname: 'Plain', company: 'Acme', email: 'plain@acme.com', dans_tags: '' }, // not a DM
  dm('10', 'Excluded'),                                        // at a client the roster excludes
  dm('11', 'Aaron'),                                           // never, sorts by name before "Never"
];
const outreachIndex = {
  emails: { 'emailed@acme.com': { tsMs: now - 5 * DAY } },
  phones: { 2125550100: { ts: iso(45) } },
};
const gates = {
  gateFor: { key: () => false, keyProspect: () => false },
  clientExclusionOf: (c) => (c.firstname === 'Excluded' ? 'cancelling' : null),
};
const myCdmGate = makeMyCdmContactGate({ prospects, cdmName: 'Dan Baldauf' });

const names = (list) => list.map(p => p.contact.firstname);
const never = decisionMakersWithoutActivity({ contacts, gates, myCdmGate, outreachIndex, nowMs: now });
assert.deepEqual(names(never), ['Aaron', 'Never'], 'no activity at all, by name');
assert.equal(never[0].lastMs, null);

const in120 = decisionMakersWithoutActivity({ contacts, gates, myCdmGate, outreachIndex, days: 120, nowMs: now });
assert.deepEqual(names(in120), ['Aaron', 'Never', 'Old'], 'never first, then the longest since');

const in30 = decisionMakersWithoutActivity({ contacts, gates, myCdmGate, outreachIndex, days: 30, nowMs: now });
assert.deepEqual(names(in30), ['Aaron', 'Never', 'Old', 'Called'], 'an index call 45 days ago is outside 30');

assert.deepEqual(decisionMakersWithoutActivity({ contacts: [], gates, myCdmGate }), []);
assert.deepEqual(decisionMakersWithoutActivity({ contacts, gates: null }), [], 'no gates yet: nothing listed');

// The account lookup pairs a contact the way the gate does.
const accountOf = makeMyCdmContactAccount({ prospects, cdmName: 'Dan Baldauf' });
assert.equal(accountOf(contacts[0]).id, 'p1');
assert.equal(accountOf(contacts[7]), null, 'another CDM\'s account is not mine');
assert.equal(accountOf({ email: 'x@acme.com' }).id, 'p1', 'no company: paired by email domain');
assert.equal(accountOf({ email: 'x@gmail.com' }), null);
assert.equal(accountOf({ id: '1', company: 'Nope' }), null);
const pinned = makeMyCdmContactAccount({ prospects, cdmName: 'Dan Baldauf', localFields: { 1: { _companyOverride: 'Acme' } } });
assert.equal(pinned({ id: '1', company: 'Nope' }).id, 'p1', 'a company typed in the app wins');
assert.equal(makeMyCdmContactAccount({ prospects, cdmName: '' })(contacts[7]).id, 'p2', 'with no CDM set, any paired account');
for (const c of contacts) assert.equal(myCdmGate(c), !!accountOf(c), 'the gate and the lookup agree');

console.log('dmsWithoutActivity: all assertions passed');
