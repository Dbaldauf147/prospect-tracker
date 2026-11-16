// Connected?: the one writer for the tick, and the opps that make a contact
// connected without one.
//
// Run: node scripts/contactConnected.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { contactConnectedUpdate, oppNamingContact, buildOppContactIndex, connectedState } = await import('../src/utils/contactConnected.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// The writer is a function of the settings at save time: it keeps a tick
// saved since the caller last rendered, which a copied map would erase.
const stored = { contactConnected: { a: true } };
const out = contactConnectedUpdate('b', true)(stored);
ok(out.contactConnected.a === true && out.contactConnected.b === true, 'ticking b keeps a');
ok(contactConnectedUpdate('a', false)(stored).contactConnected.a === false, 'unticking stores false');
ok(contactConnectedUpdate('a', true)(stored) === null, 'no change, no save');
ok(contactConnectedUpdate('', true)(stored) === null, 'no id, no save');
ok(contactConnectedUpdate('z', true)({}).contactConnected.z === true, 'works with no map yet');

const opps = [
  { Account: 'CBRE', Contact: 'Mathew Chamish, Ann Lee', Stage: 'Quoted' },
  { Account: 'Apollo', Contact: 'John Smith', _contactEmails: { 'john smith': 'jsmith@apollo.com' } },
  { Account: 'Hines', Contact: 'Jane Doe' },
];
const idx = buildOppContactIndex(opps);
ok(oppNamingContact({ firstname: 'Mathew', lastname: 'Chamish', company: 'CBRE Investment Management' }, idx)?.Account === 'CBRE', 'name at a longer spelling of the account');
ok(oppNamingContact({ firstname: 'Jane', lastname: 'Doe', company: 'Blackstone' }, idx) === null, 'same name at another company is not them');
ok(oppNamingContact({ firstname: 'Jane', lastname: 'Doe', company: '' }, idx)?.Account === 'Hines', 'no company: the name is enough');
ok(oppNamingContact({ firstname: 'Johnny', lastname: 'S', email: 'JSmith@apollo.com', company: 'Other' }, idx)?.Account === 'Apollo', 'the opp\'s stored email matches whatever the name');
ok(oppNamingContact({ firstname: 'Nobody', lastname: 'Here' }, idx) === null, 'not on any opp');
ok(oppNamingContact({ firstname: 'Ann', lastname: 'Lee', company: 'CBRE' }, opps)?.Account === 'CBRE', 'takes the plain opps list too');

const c = { id: '7', firstname: 'Ann', lastname: 'Lee', company: 'CBRE' };
ok(connectedState(c, {}, idx).on === true && connectedState(c, {}, idx).manual === false, 'on an opp: connected without a tick');
ok(connectedState(c, { 7: false }, idx).on === true, 'an untick does not override the opp');
ok(connectedState({ id: '8', firstname: 'X', lastname: 'Y' }, { 8: true }, idx).on === true, 'a tick alone is connected');
ok(connectedState({ id: '9', firstname: 'X', lastname: 'Y' }, {}, null).on === false, 'neither: not connected');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
