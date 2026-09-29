// Assertion tests for importing SIA consumption into the Broker Fees table.
// Plain Node - no test framework. Run:
//   node scripts/brokerFeesSiaImport.test.mjs
import { brokerFeeImportFor, mergeSiaImports } from '../src/utils/brokerFeesSiaImport.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const entry = (details) => ({ options: [{ headerDetails: details.map(([label, value]) => ({ label, value })) }] });

check('reads company, kWh and Dth',
  brokerFeeImportFor(entry([['Client', 'Acme'], ['Annual kWh', '1,234,567.4'], ['Annual Gas (Dth)', '25032']])),
  { company: 'Acme', loadEp: '1234567', loadNg: '25032' });
check('MMBtu carries over as Dth',
  brokerFeeImportFor(entry([['Company Name', 'Beta'], ['Annual MMBtu', '900']])),
  { company: 'Beta', loadEp: '', loadNg: '900' });
check('nothing to import', brokerFeeImportFor(entry([['Salesperson', 'Pat']])), null);

const EMPTY = { company: '', loadEp: '', feeEp: '', rfps: '', loadNg: '', feeNg: '' };
const table = [
  { company: 'Jamestown', loadEp: '1', feeEp: '0.00075', rfps: '4', loadNg: '5', feeNg: '0.18' },
  { ...EMPTY },
];

let r = mergeSiaImports(table, [{ company: ' jamestown ', loadEp: '26616828', loadNg: '' }]);
check('same company updates loads, keeps fees and a load the SIA lacks', r.rows[0],
  { company: 'Jamestown', loadEp: '26616828', feeEp: '0.00075', rfps: '4', loadNg: '5', feeNg: '0.18' });
check('update counted', [r.updated, r.added], [1, 0]);

r = mergeSiaImports(table, [{ company: 'Acme', loadEp: '10', loadNg: '20' }, { company: 'Beta', loadEp: '30', loadNg: '' }]);
check('new company takes the blank padding row', r.rows[1], { company: 'Acme', loadEp: '10', feeEp: '', rfps: '', loadNg: '20', feeNg: '' });
check('then goes on the end', r.rows[2].company, 'Beta');
check('added counted', [r.updated, r.added, r.rows.length], [0, 2, 3]);
check('input not mutated', table[1], EMPTY);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
