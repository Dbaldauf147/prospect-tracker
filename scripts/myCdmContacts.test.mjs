// Assertion tests for makeMyCdmContactGate: the DMs tab keeps only contacts
// at a Table View company whose CDM is the user. Run:
//   node scripts/myCdmContacts.test.mjs
import { makeMyCdmContactGate } from '../src/utils/myCdmContacts.js';

let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}`);
}

const prospects = [
  { company: 'Ameriprise Financial', cdm: 'Dan Baldauf', emailDomain: 'ampf.com' },
  { company: 'TPG', cdm: 'Cristy House', website: 'https://www.tpg.com/about' },
  { company: 'La Caisse', cdm: '' },
  { company: 'Brookfield Asset Management', cdm: 'Dan Baldauf' },
];
const mine = makeMyCdmContactGate({ prospects, cdmName: 'Dan Baldauf' });

ok('a contact at one of my accounts is kept', mine({ id: '1', company: 'Ameriprise Financial' }));
ok('case and spacing do not matter', mine({ id: '2', company: '  ameriprise financial ' }));
ok('another CDM\'s account is dropped', !mine({ id: '3', company: 'TPG' }));
ok('an account with no CDM is dropped', !mine({ id: '4', company: 'La Caisse' }));
ok('a company not on the Table View is dropped', !mine({ id: '5', company: 'Barclays Investment' }));
ok('no fuzzy match: a near-name is not my account', !mine({ id: '6', company: 'Brookfield Properties' }));
ok('no company: the email domain finds my account', mine({ id: '7', company: '', email: 'x@ampf.com' }));
ok('no company: a website domain finds another CDM\'s', !mine({ id: '8', email: 'y@tpg.com' }));
ok('a company name wins over the email domain', !mine({ id: '9', company: 'TPG', email: 'z@ampf.com' }));
ok('a free-mail address maps to nobody', !mine({ id: '10', email: 'a@gmail.com' }));

const pinned = makeMyCdmContactGate({
  prospects, cdmName: 'Dan Baldauf',
  localFields: { 11: { _companyOverride: 'Ameriprise Financial' } },
});
ok('a Company typed in the app wins over HubSpot\'s', pinned({ id: '11', company: 'TPG' }));

const nobody = makeMyCdmContactGate({ prospects, cdmName: '' });
ok('with no CDM set, nothing is filtered', nobody({ id: '12', company: 'TPG' }));

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
