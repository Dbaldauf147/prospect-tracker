// Assertion tests for carrying a client's COA requirements onto its opps.
// Plain Node, no test framework. Run:
//   node scripts/clientCoaFlags.test.mjs
//
// What has to hold:
//   1. Only companies with answers are indexed, and an Account finds its
//      client by name, by "(...)" alias, or by a former name - with the
//      company's own name winning over another company's former name.
//   2. The flag names the required items not yet sent for approval, and
//      clears once each is requested, approved or marked N/A.
//   3. It stays down on closed opps and at Agreement Sent (the red flag's
//      stage), and for clients with no required items.
//   4. A required item the Dropdowns list no longer names still counts.

import {
  buildClientCoaIndex, clientCoaFor, clientRequiredCoaNotRequested,
  catalogWithClientRequired, clientCoaAnswer, EMPTY_CLIENT_COA_INDEX,
} from '../src/utils/clientCoaFlags.js';

let failures = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
}
function eq(label, actual, expected) {
  check(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const prospects = [
  { company: 'Acme Corp', aliases: 'Old Acme', coaRequirements: {
    '3% esc': { item: '3% esc', required: 'yes', notes: 'MSA 4.2' },
    'net 60': { item: 'Net 60', required: 'no', notes: '' },
    'legacy cap': { item: 'Legacy cap', required: 'yes', notes: '' },
  } },
  { company: 'Beta LLC', coaRequirements: { 'net 60': { item: 'Net 60', required: 'no' } } },
  { company: 'Gamma', aliases: 'Acme Corp' , coaRequirements: { 'x': { item: 'X', required: 'yes' } } },
  { company: 'No Answers Inc' },
];
const index = buildClientCoaIndex(prospects);

eq('no answers anywhere is the empty index', buildClientCoaIndex([{ company: 'A' }]), EMPTY_CLIENT_COA_INDEX);
eq('exact name', clientCoaFor('Acme Corp', index)?.company, 'Acme Corp');
eq("own name beats another company's former name", clientCoaFor('ACME CORP', index)?.company, 'Acme Corp');
eq('former name', clientCoaFor('Old Acme', index)?.company, 'Acme Corp');
eq('alias in parentheses', clientCoaFor('Big Holdings (Old Acme)', index)?.company, 'Acme Corp');
eq('a company with no answers is not found', clientCoaFor('No Answers Inc', index), null);
eq('blank account', clientCoaFor('', index), null);

const acme = clientCoaFor('Acme Corp', index);
eq('required items', acme.required.map(r => r.item), ['3% esc', 'Legacy cap']);
eq('answer lookup is case-insensitive', clientCoaAnswer(acme, '3% ESC'), { required: 'yes', notes: 'MSA 4.2' });
eq('not-required answer', clientCoaAnswer(acme, 'net 60').required, 'no');
eq('unanswered', clientCoaAnswer(acme, 'Other').required, '');

const catalog = ['3% esc', 'Net 60'];
eq('required item off the list is added to it', catalogWithClientRequired(catalog, acme), ['3% esc', 'Net 60', 'Legacy cap']);

const names = (rows) => rows.map(r => r.item);
eq('open opp with nothing recorded: both required items named',
  names(clientRequiredCoaNotRequested({ Stage: 'Quoted' }, acme, catalog)), ['3% esc', 'Legacy cap']);
eq('requested clears it',
  names(clientRequiredCoaNotRequested({ Stage: 'Quoted', _coaItems: [{ item: '3% esc', requested: '2026-09-01', approved: '' }] }, acme, catalog)),
  ['Legacy cap']);
eq('approved and N/A clear it',
  names(clientRequiredCoaNotRequested({ Stage: 'Quoted', _coaItems: [
    { item: '3% ESC', requested: '', approved: '2026-09-02' },
    { item: 'Legacy cap', requested: '', approved: '', na: true },
  ] }, acme, catalog)), []);
eq('closed opp', clientRequiredCoaNotRequested({ Stage: 'Sold' }, acme, catalog), []);
eq('Agreement Sent is left to the red flag', clientRequiredCoaNotRequested({ Stage: 'Agreement Sent' }, acme, catalog), []);
eq('client with only not-required answers', clientRequiredCoaNotRequested({ Stage: 'Quoted' }, clientCoaFor('Beta LLC', index), catalog), []);
eq('no client', clientRequiredCoaNotRequested({ Stage: 'Quoted' }, null, catalog), []);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll passed');
