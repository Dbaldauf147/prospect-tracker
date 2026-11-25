// Assertion tests for utils/companyAliases (merge-duplicate aliases).
// Plain Node, no framework. Run: node scripts/companyAliases.test.mjs
import { recordCompanyKeys, mergedCompanyAliases, accountIsCompany } from '../src/utils/companyAliases.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

eq(recordCompanyKeys({ company: 'WSP' }), ['wsp'], 'a record without aliases has just its own key');
eq(recordCompanyKeys({ company: 'WSP', companyAliases: ['WSP Global', 'WSP Inc.', ''] }), ['wsp', 'wspglobal'],
  'aliases add their keys; a suffix variant of the name and blanks add nothing');
eq(recordCompanyKeys({ company: '' }), [], 'no name, no keys');
eq(recordCompanyKeys({ company: 'WSP', companyAliases: 'WSP Global' }), ['wsp'], 'a malformed alias field is ignored');

eq(mergedCompanyAliases({ company: 'WSP' }, { company: 'WSP Global' }), ['WSP Global'],
  'merging records the absorbed name');
eq(mergedCompanyAliases({ company: 'WSP', companyAliases: ['WSP Global'] }, { company: 'WSP Global Inc.', companyAliases: ['Parsons Brinckerhoff'] }),
  ['WSP Global', 'Parsons Brinckerhoff'], 'merging again keeps old aliases, skips a spelling already held, adds the absorbed aliases');
eq(mergedCompanyAliases({ company: 'WSP' }, { company: 'WSP, Inc.' }), [],
  'a name that already reads as the survivor is not an alias');
eq(mergedCompanyAliases({ company: 'WSP Global' }, { company: 'WSP', companyAliases: ['WSP Global'] }), ['WSP'],
  'merging the other way round never lists the survivor as its own alias');

const bam = { company: 'Brookfield Asset Management', companyAliases: ['Brookfield Asset Management Inc (BAM) - Headquarters'] };
eq(accountIsCompany('Brookfield Asset Management', bam), true, 'opp under the company name');
eq(accountIsCompany('brookfield asset management, inc.', bam), true, 'case, punctuation and Inc. do not matter');
eq(accountIsCompany('Brookfield Asset Management Inc (BAM) - Headquarters', bam), true, 'a name merged into the company');
eq(accountIsCompany('Brookfield (Core Retail)', bam), false, 'a division sharing a word of the name is not the company');
eq(accountIsCompany('Brookfield', bam), false, 'a shorter related name is not the company');
eq(accountIsCompany('Brookfield US Logistics', bam), false, 'a portfolio company is not the company');
eq(accountIsCompany('', bam), false, 'no account');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
