// Assertion tests for the rule that a contact ticked Connected? is never a
// Key Prospect: someone Dan is already connected with is past prospecting.
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
eq('connected: not a Key Prospect', gates.isKeyProspect(amy), false);
eq('connected: still Key (only Key Prospect changes)', gates.categorize(amy), ['Key']);
eq('connected: explained', gates.explain(amy).rosters.find(r => r.label === 'Key Prospect').why, 'Connected? is ticked, so they are past being a prospect.');
eq('unticked (false) stays a Key Prospect', gates.isKeyProspect(bo), true);
eq('no map: same as before', makeRosterGates({ prospects, cdmName, oppsRecords: [], connected: null }).isKeyProspect(bo), true);

if (failed) { console.log(`\n${failed} failure(s)`); process.exit(1); }
console.log('\nAll passed');
