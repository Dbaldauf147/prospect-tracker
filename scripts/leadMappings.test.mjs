// Assertion tests for the Marketing Leads Company Mapping guard. Plain
// Node, no test framework. Run:
//   node scripts/leadMappings.test.mjs
//
// Mappings accepted on the Marketing Leads page came back unmapped on the
// next load: some writer rewrote settings.marketingLeads from a copy taken
// before the mapping was set. These cover the save guard and the ledger.
import { guardLeadMappings, recordLeadMappings } from '../src/utils/leadMappings.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const lead = (over = {}) => ({ id: 'x', name: '', company: '', mappedCompany: '', ...over });

// ---- the save guard --------------------------------------------------

const prev = [
  lead({ id: '1', name: 'Kerry Gawrych', company: 'ElmTree Funds', mappedCompany: 'ElmTree Funds' }),
  lead({ id: '2', name: 'Colin Walker', company: 'Grubb Properties', mappedCompany: 'Grubb Properties' }),
];
const stale = [
  lead({ id: '1', name: 'Kerry Gawrych', company: 'ElmTree Funds', status: 'Working' }),
  lead({ id: '2', name: 'Colin Walker', company: 'Grubb Properties' }),
];
let g = guardLeadMappings(stale, prev);
eq(g.rows.map(r => r.mappedCompany), ['ElmTree Funds', 'Grubb Properties'], 'a stale rewrite cannot blank mappings the leads already carry');
eq(g.rows[0].status, 'Working', 'the rest of the stale write still lands');
eq(g.restored.length, 2, 'every restored mapping is reported');

g = guardLeadMappings(stale, prev, ['1']);
eq(g.rows.map(r => r.mappedCompany), ['', 'Grubb Properties'], 'a deliberate clear of one lead goes through; the other is kept');

const untouched = prev.map(r => ({ ...r }));
g = guardLeadMappings(untouched, prev);
eq(g.rows === untouched, true, 'a write that blanks nothing comes back as the same array');

g = guardLeadMappings([lead({ id: '1', mappedCompany: 'Grubb Properties' })], prev);
eq(g.rows[0].mappedCompany, 'Grubb Properties', 'changing a mapping to a different account is allowed');

g = guardLeadMappings(stale, stale, [], { 1: { company: 'ElmTree Funds' } });
eq(g.rows.map(r => r.mappedCompany), ['ElmTree Funds', ''], 'the ledger restores a mapping even when this tab already lost it');

g = guardLeadMappings(stale, stale, ['1'], { 1: { company: 'ElmTree Funds' } });
eq(g.rows[0].mappedCompany, '', 'a deliberate clear wins over the ledger too');

// ---- the ledger ------------------------------------------------------

const ledger = recordLeadMappings({}, prev, [], 100);
eq(Object.keys(ledger), ['1', '2'], 'every mapping in a write is recorded');
eq(ledger['1'], { company: 'ElmTree Funds', at: 100 }, 'an entry carries the account and time');
eq(recordLeadMappings(ledger, prev, [], 200) === ledger, true, 'recording the same mappings again changes nothing');
eq(recordLeadMappings(ledger, stale, [], 200) === ledger, true, 'a write without the mappings leaves the ledger alone');
eq(Object.keys(recordLeadMappings(ledger, stale, ['2'], 200)), ['1'], 'a deliberate clear drops that lead from the ledger');
eq(recordLeadMappings(ledger, [lead({ id: '1', mappedCompany: 'Grubb Properties' })], [], 300)['1'].company, 'Grubb Properties', 'a changed mapping replaces the entry');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
