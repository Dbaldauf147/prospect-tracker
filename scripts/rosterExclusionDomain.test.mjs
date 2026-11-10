// A Clients-tab flag (Cancelling for Sure / Don't Track) takes an account's
// contacts off every roster, matched by name and by email domain. The domain
// is only a fallback: a flagged account sharing a domain with a working one
// must not take a contact whose Company names the working account.
import { makeRosterGates } from '../src/utils/contactRosters.js';

let passed = 0, failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed += 1; else { failed += 1; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

const CDM = 'Dan Baldauf';
const prospects = [
  { company: 'Blackstone', status: 'Qualifying', cdm: CDM, tier: 'Tier 1' },
  { company: 'Blackstone Real Estate', status: 'Client', cdm: CDM, website: 'https://www.blackstone.com' },
];
const gates = makeRosterGates({
  prospects, cdmName: CDM, oppsRecords: [],
  clientStatusMap: {}, clientUntrackedMap: { 'blackstone real estate': true },
});
const contact = (company, tags = 'Dan Key Target') => ({ id: company || 'none', firstname: 'Dan', lastname: 'Egan', email: 'daniel.egan@blackstone.com', company, dans_tags: tags });

check('Company names the working account: kept', gates.clientExclusionOf(contact('Blackstone')), '');
check('and on the All rollup', gates.rosterSelector(contact('Blackstone')), true);
check('Company names the flagged account: left out', gates.clientExclusionOf(contact('Blackstone Real Estate')), 'untracked');
check('no Company text: the domain still leaves them out', gates.clientExclusionOf(contact('')), 'untracked');
check('Company matches no account: the domain still leaves them out', gates.clientExclusionOf(contact('BX Holdings')), 'untracked');

const cancelling = makeRosterGates({
  prospects, cdmName: CDM, oppsRecords: [],
  clientStatusMap: { 'blackstone real estate': 'Cancelling for Sure' }, clientUntrackedMap: {},
});
check('same rule for Cancelling for Sure', cancelling.clientExclusionOf(contact('Blackstone')), '');
check('Cancelling account itself still left out', cancelling.clientExclusionOf(contact('Blackstone Real Estate')), 'cancelling');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
