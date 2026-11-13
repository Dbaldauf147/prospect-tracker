// Assertion tests for Connected? and Key Prospect. Connected? used to take a
// contact off Key Prospect; it no longer does, so a Decision Maker at a tiered
// account stays a Key Prospect whether or not it's ticked.
// Plain Node, no framework. Run:
//   node scripts/keyProspectConnected.test.mjs
import { makeRosterGates } from '../src/utils/contactRosters.js';

let failed = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const cdmName = 'Dan Baldauf';
const prospects = [{ id: 'p1', company: 'Nuveen', cdm: cdmName, tier: 'Tier 1', status: 'Prospect' }];
const amy = { id: 101, firstname: 'Amy', lastname: 'Nazarian', company: 'Nuveen', dans_tags: 'Decision Maker;Dan Key Target' };
const bo = { id: 102, firstname: 'Bo', lastname: 'Ng', company: 'Nuveen', dans_tags: 'Decision Maker' };

const plain = makeRosterGates({ prospects, cdmName, oppsRecords: [] });
eq('not connected: Key Prospect', plain.isKeyProspect(amy), true);

const gates = makeRosterGates({ prospects, cdmName, oppsRecords: [], connected: { 101: true, 102: false } });
eq('connected: still a Key Prospect', gates.isKeyProspect(amy), true);
eq('connected: Key and Key Prospect', gates.categorize(amy), ['Key', 'Key Prospect']);
eq('connected: nothing blocks it', gates.explain(amy).rosters.find(r => r.label === 'Key Prospect').why, '');
eq('unticked (false) stays a Key Prospect', gates.isKeyProspect(bo), true);
eq('no map: same as before', makeRosterGates({ prospects, cdmName, oppsRecords: [], connected: null }).isKeyProspect(bo), true);

// The rule as it stands: Decision Maker at a Tier 1/2/3 or Dan-target account
// on the book, not at a Client. Opps on the account don't matter.
const book = [
  { id: 'p1', company: 'Nuveen', cdm: cdmName, tier: 'Tier 1', status: 'Prospect' },
  { id: 'p2', company: 'Willco', cdm: 'Someone Else', tier: 'Not on tier list', tierOwnTarget: true, status: 'Prospect' },
  { id: 'p3', company: 'Off Book', cdm: 'Someone Else', tier: 'Tier 1', status: 'Prospect' },
];
const g2 = makeRosterGates({ prospects: book, cdmName, oppsRecords: [{ Account: 'Nuveen', Stage: 'Proposal' }] });
eq('account with opps: still a Key Prospect', g2.isKeyProspect(bo), true);
eq('Dan target under another CDM: Key Prospect', g2.isKeyProspect({ id: 201, company: 'Willco', dans_tags: 'Decision Maker' }), true);
eq('Tier 1 on another CDM: not', g2.isKeyProspect({ id: 202, company: 'Off Book', dans_tags: 'Decision Maker' }), false);
eq('not a Decision Maker: not', g2.isKeyProspect({ id: 203, company: 'Nuveen', dans_tags: 'ESG' }), false);

if (failed) { console.log(`\n${failed} failure(s)`); process.exit(1); }
console.log('\nAll passed');
