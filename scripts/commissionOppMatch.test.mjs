// Commissions tab: suggesting the Opps row a commission row is for, from
// its Project Name against each opp's BFO Opportunity Name. Run:
//   node scripts/commissionOppMatch.test.mjs
import {
  buildOppIndex, suggestOpps, searchOppIndex, scoreProjectAgainstBfo, fieldsFromOpp, commissionProjectName,
} from '../src/utils/commissionOppMatch.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const opps = [
  { 'BFO Link': 'Griffis Properties_DBB-04192022 Am 5_SUSUP', Account: 'Griffis Residential', Scope: 'Utility Bill Mgmt', Stage: 'Closed Won' },
  { 'BFO Link': 'Griffis Properties_DBB-04192022 Am 4_SUSUP', Account: 'Griffis Residential', Scope: 'Utility Bill Mgmt', Stage: 'Closed Won' },
  { 'BFO Link': 'Prologis_SoW#7 Am 1 Ad Hoc 1_SUSUP', Account: 'Prologis', Scope: 'ESG Reporting', Stage: 'Closed Won' },
  { 'BFO Link': 'prologis_sow#7 am 1 ad hoc 1_susup', Account: 'Prologis (dupe)', Scope: '', Stage: '' },
  { 'BFO Link': 'Willco Construction 1st Amendment', Account: 'Willco', Scope: 'Energy Procurement', Stage: 'Closed Won' },
  { 'BFO Link': '-', Account: 'Placeholder' },
  { 'BFO Link': '#N/A', Account: 'Placeholder' },
  { 'BFO Link': '', Account: 'Placeholder' },
];
const index = buildOppIndex(opps);

eq(index.entries.length, 4, 'placeholders and same-name repeats are left out of the index');

eq(scoreProjectAgainstBfo('Prologis_SoW#7 Am 1 Ad Hoc 1_SUSUP', 'prologis sow 7 am 1 ad hoc 1 susup'), 1,
  'same name up to case, spacing and punctuation scores 1');
eq(scoreProjectAgainstBfo('Willco Construction 1st Amendment', 'Willco Construction 1st Amendment - Renewal'), 0.9,
  'one name inside the other scores 0.9');
eq(scoreProjectAgainstBfo('Acme Corp', 'Blackrock MSA'), 0, 'unrelated names score 0');

const griffis = suggestOpps(index, 'Griffis Properties_DBB-04192022 Am 5_SUSUP');
eq(griffis.map(s => s.name), [
  'Griffis Properties_DBB-04192022 Am 5_SUSUP',
  'Griffis Properties_DBB-04192022 Am 4_SUSUP',
], 'the exact amendment ranks first, the sibling amendment after it');
eq(griffis[0].score, 1, 'and the exact one scores 1');

eq(suggestOpps(index, 'Blackrock, Inc._MSA KTM-32426_SUSUP'), [], 'nothing close enough, no suggestions');
eq(suggestOpps(buildOppIndex([]), 'Griffis'), [], 'no opps, no suggestions');

eq(searchOppIndex(index, 'energy', 'anything').map(s => s.name), ['Willco Construction 1st Amendment'],
  'search reads Scope too');
eq(searchOppIndex(index, 'griffis', 'Griffis Properties_DBB-04192022 Am 4_SUSUP').map(s => s.name)[0],
  'Griffis Properties_DBB-04192022 Am 4_SUSUP', 'search results rank by the row\'s project name');

eq(fieldsFromOpp(opps[4]), { 'Account Name': 'Willco', 'BFO Name': 'Willco Construction 1st Amendment' },
  'picking an opp fills Account Name and BFO Name');

eq(commissionProjectName({ 'Project Name': ' P1 ', Name: 'N1' }), 'P1', 'Project Name wins');
eq(commissionProjectName({ Name: 'N1' }), 'N1', 'falls back to Name');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
