// Assertion tests for the Key Prospect roster's "via" label: which Table
// View company put a contact on the roster. Plain Node, no framework. Run:
//   node scripts/keyProspectVia.test.mjs
//
// The label exists to make a loose name match visible, so what's worth
// pinning is that it names the account the gate actually matched, stays
// blank for anyone not on the roster, and that the match no longer lets a
// short name ("KKR") ride in on a longer one ("Accel-KKR").
import { makeRosterGates, rosterTagCoverage } from '../src/utils/contactRosters.js';

let failed = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const cdmName = 'Dan Baldauf';
const prospects = [
  { id: 'p1', company: 'Accel-KKR', cdm: cdmName, tier: 'Tier 3', status: 'Prospect' },
  { id: 'p2', company: 'Brookfield Asset Management', cdm: cdmName, tier: 'Tier 2', status: 'Prospect' },
  { id: 'p3', company: 'Nuveen', cdm: cdmName, tier: 'Tier 1', status: 'Prospect' },
];
const contacts = [
  { id: 'c1', firstname: 'Ari', lastname: 'Frankel', company: 'KKR', dans_tags: 'Decision Maker' },
  { id: 'c2', firstname: 'Ann', lastname: 'Lee', company: 'Brookfield Asset Management Ltd.', dans_tags: 'Decision Maker' },
  { id: 'c3', firstname: 'Amy', lastname: 'Nazarian', company: 'Nuveen', dans_tags: 'Decision Maker' },
  { id: 'c4', firstname: 'Bo', lastname: 'Ng', company: 'Nuveen', dans_tags: '' },
];
const gates = makeRosterGates({ prospects, cdmName, oppsRecords: [] });
const cov = rosterTagCoverage({ contacts, gates });
const kp = Object.fromEntries((cov.keyProspect?.people || []).map(p => [p.id, p.keyProspectVia]));

eq('KKR contact is not a Key Prospect at Accel-KKR', 'c1' in kp, false);
eq('suffix-drift match names the Table View company', kp.c2, 'Brookfield Asset Management');
eq('exact match names the same company', kp.c3, 'Nuveen');
eq('not a decision maker: not on the roster', 'c4' in kp, false);
eq('keyProspectAccountOf blank for non-Key-Prospects', gates.keyProspectAccountOf(contacts[3]), '');

if (failed) { console.log(`\n${failed} failure(s)`); process.exit(1); }
console.log('\nAll passed');
