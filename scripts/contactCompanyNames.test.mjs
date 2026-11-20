// Assertion tests for a contact's HubSpot / Prospect Tracker company names.
// Plain Node, no test framework. Run:
//   node scripts/contactCompanyNames.test.mjs
import { hubspotCompanyNameOf, tableViewNameKeys, isTableViewName } from '../src/utils/contactCompanyNames.js';
import { companyOverridesByIdUpdate, withCompanyPins } from '../src/utils/contactCompanyOverride.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const keys = tableViewNameKeys([{ company: 'Kenco Logistics' }, { company: ' Acme Corporation ' }, { company: '' }, null]);

check('exact Table View name', isTableViewName('Kenco Logistics', keys), true);
check('case and outer spaces forgiven', isTableViewName('  kenco logistics ', keys), true);
check('a different spelling is not a match', isTableViewName('Acme Corp', keys), false);
check('unknown company', isTableViewName('Kenco Group', keys), false);
check('blank is not a match', isTableViewName('', keys), false);

check('HubSpot name is the synced value, tidied', hubspotCompanyNameOf(' Kenco Group '), 'Kenco Group');
check('no HubSpot company', hubspotCompanyNameOf(undefined), '');

// Applying a guess is a local pin only: the synced contact keeps HubSpot's
// name, and the pin is what Prospect Tracker reads.
const synced = [{ id: '7', company: 'Kenco Group' }, { id: '8', company: 'Kenco' }];
const next = companyOverridesByIdUpdate({ 7: 'Kenco Logistics', 8: 'Kenco Logistics' })({ contactLocalFields: {} });
check('guess pins every contact in one write', next.contactLocalFields,
  { 7: { _companyOverride: 'Kenco Logistics' }, 8: { _companyOverride: 'Kenco Logistics' } });
check('synced HubSpot value untouched', synced.map(c => hubspotCompanyNameOf(c.company)), ['Kenco Group', 'Kenco']);
check('Prospect Tracker reads the pin', withCompanyPins(synced, next.contactLocalFields).map(c => c.company),
  ['Kenco Logistics', 'Kenco Logistics']);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
