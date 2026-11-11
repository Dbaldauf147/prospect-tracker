// A contact at a Client is never a Key Prospect, even when their HubSpot
// company is spelled differently from the Client account (so the exact-name
// Client gate misses them) and the near-name match lands on another,
// non-Client Tier 1-3 row - the Piedmont / Jon Kuskie case.
import { makeRosterGates } from '../src/utils/contactRosters.js';

let passed = 0, failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed += 1; else { failed += 1; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

const CDM = 'Dan Baldauf';
const prospects = [
  { company: 'Piedmont Office Realty Trust Inc.', status: 'Client', cdm: CDM, tier: 'Tier 1', emailDomain: 'firstname.lastname@piedmontreit.com' },
  // A stray duplicate row for the same company, not marked Client.
  { company: 'Piedmont Office Realty Trust', status: 'Prospect', cdm: CDM, tier: 'Tier 1' },
  { company: 'Blackstone', status: 'Qualifying', cdm: CDM, tier: 'Tier 1' },
  { company: 'Piedmont Natural Gas', status: 'Prospect', cdm: CDM, tier: 'Tier 2' },
];
const gates = makeRosterGates({ prospects, cdmName: CDM, oppsRecords: [] });
const dm = (company, email) => ({ id: `${company}|${email}`, firstname: 'J', lastname: 'K', email, company, dans_tags: 'Decision Maker' });

const jon = dm('Piedmont Office Realty Trust', 'jon.kuskie@piedmontreit.com');
check('near-name contact at a Client is not a Key Prospect', gates.isKeyProspect(jon), false);
check('categorize leaves Key Prospect off', gates.categorize(jon).includes('keyProspect'), false);
const why = gates.explain(jon).rosters.find(r => r.label === 'Key Prospect').why;
check('explain names the Client', why, 'They belong to "Piedmont Office Realty Trust Inc.", a Client, and Clients aren\'t prospects.');

check('Client email domain alone rules it out',
  gates.isKeyProspect(dm('Piedmont Office Realty Trust', 'jon@piedmontreit.com')), false);
check('a real prospect is still a Key Prospect', gates.isKeyProspect(dm('Blackstone', 'a@blackstone.com')), true);
check('a differently named company sharing a word is unaffected',
  gates.isKeyProspect(dm('Piedmont Natural Gas', 'a@piedmontng.com')), true);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
