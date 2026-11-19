// Assertion tests for a contact's HubSpot / Prospect Tracker company names.
// Plain Node, no test framework. Run:
//   node scripts/contactCompanyNames.test.mjs
import { buildCompanyRecordLookup, hubspotCompanyNamesFor } from '../src/utils/contactCompanyNames.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const pnc = { id: 1, company: 'PNC Bank', hubspotCompanyNames: 'PNC Financial Services\nPNC\npnc' };
const hines = { id: 2, company: 'Hines', hubspotCompanyNames: '' };
const other = { id: 3, company: 'PNC', hubspotCompanyNames: 'Hines' };
const find = buildCompanyRecordLookup([pnc, hines, other]);

check('by company name, any case', find(' pnc bank ')?.id, 1);
check('by a recorded HubSpot name', find('PNC Financial Services')?.id, 1);
check("a record's own name beats another record's HubSpot name", find('PNC')?.id, 3);
check('same the other way round', find('Hines')?.id, 2);
check('unknown company', find('Nobody Inc'), null);
check('blank company', find(''), null);

check('recorded names are kept, all of them, one spelling each',
  hubspotCompanyNamesFor('PNC Bank', pnc), ['PNC Financial Services', 'PNC']);
check('none recorded: the company name', hubspotCompanyNamesFor('Hines', hines), ['Hines']);
check('no record: the company name', hubspotCompanyNamesFor(' Nobody Inc ', null), ['Nobody Inc']);
check('no company at all', hubspotCompanyNamesFor('', null), []);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
