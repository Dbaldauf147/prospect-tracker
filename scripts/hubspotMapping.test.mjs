// Assertion tests for the My Accounts > Hubspot Mapping subtab's matching
// (src/utils/hubspotMapping.js). Plain Node, no framework. Run:
//   node scripts/hubspotMapping.test.mjs
//
// What has to hold:
//   * the export's columns are read by HubSpot's labels, "(No value)" is blank,
//   * an account matches by name, goes-by or alias, and every same-named
//     HubSpot record comes with it (duplicates show),
//   * an account with no match gets HubSpot companies starting the same
//     way as possible matches; a link picks one and claims it,
//   * HubSpot companies no account claims are listed on their own.
import { compactMappingCompanies, buildHubspotMapping, MAPPING_STATUS } from '../src/utils/hubspotMapping.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const companies = compactMappingCompanies([
  { 'Company name': '3650 REIT', 'Company owner': 'Dan Baldauf', 'Target Account': '(No value)', 'Lifecycle Stage': 'Lead', 'Company ID': '1' },
  { 'Company name': '3650 REIT', 'Company owner': 'Dan Baldauf', 'Company ID': '2' },
  { 'Company name': 'Acme Realty Partners', 'Company ID': '3' },
  { 'Company name': 'Blue Owl Capital', 'Company ID': '4' },
  { 'Company name': 'Zed Holdings Inc.', 'Company ID': '5' },
  { 'Company name': '(No value)', 'Company ID': '6' },
]);
eq(companies.length, 5, 'a row without a name is dropped');
eq([companies[0].targetAccount, companies[0].lifecycle, companies[0].owner], ['', 'Lead', 'Dan Baldauf'], '"(No value)" reads as blank');

const accounts = [
  { id: 'a', company: '3650 REIT' },
  { id: 'b', company: 'Acme' },
  { id: 'c', company: 'Owl', aliases: ['Blue Owl Capital'] },
  { id: 'd', company: 'Nobody Here' },
  { id: 'e', company: 'Zed' },
];
let rows = buildHubspotMapping(accounts, companies);
const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
eq(byKey['a:a'].hubspot.map(c => c.id), ['1', '2'], 'every same-named HubSpot record comes with the account');
eq(byKey['a:c'].status, MAPPING_STATUS.matched, 'an alias matches');
eq(byKey['a:e'].hubspot.map(c => c.id), ['5'], 'corporate suffixes are ignored');
eq([byKey['a:b'].status, byKey['a:b'].suggestions.map(c => c.id)], [MAPPING_STATUS.accountOnly, ['3']], 'a name starting the same way is a possible match');
eq(byKey['a:d'].suggestions, [], 'nothing alike, nothing suggested');
eq(rows.filter(r => r.status === MAPPING_STATUS.hubspotOnly).map(r => r.hubspot[0].id), ['3'], 'an unclaimed HubSpot company is listed on its own');
eq(buildHubspotMapping([], companies).filter(r => r.hubspot.length > 1).map(r => r.hubspot.map(c => c.id)), [['1', '2']], 'same-named unclaimed records share a row');

rows = buildHubspotMapping(accounts, companies, { links: { b: '3' } });
eq(rows.find(r => r.key === 'a:b').how, 'linked', 'a link maps the account');
eq(rows.filter(r => r.status === MAPPING_STATUS.hubspotOnly).length, 0, 'a linked company is no longer HubSpot-only');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
