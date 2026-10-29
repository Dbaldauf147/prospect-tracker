// Assertion tests for the My Accounts > Hubspot Mapping subtab's matching
// (src/utils/hubspotMapping.js). Plain Node, no framework. Run:
//   node scripts/hubspotMapping.test.mjs
//
// What has to hold:
//   * the export's columns are read by HubSpot's labels, "(No value)" is blank,
//   * an account matches by website (Company Domain Name / Website URL
//     against its Website or Email Domain), then by name, goes-by or alias, and every same-named
//     HubSpot record comes with it (duplicates show),
//   * an account with no match gets the closest unclaimed HubSpot names as
//     possible matches with a % (and a HubSpot-only company the closest
//     unmatched accounts); generic words alone don't make names alike; a
//     link picks one and claims it,
//   * a Client that isn't a Customer in HubSpot is flagged, and so is a
//     HubSpot Customer that isn't a Client or Old Client here,
//   * HubSpot companies no account claims are listed on their own.
import { compactMappingCompanies, buildHubspotMapping, statusDiscrepancy, nameSimilarity, likelyDuplicateName, MAPPING_STATUS, hubspotOnlyOwnedRows } from '../src/utils/hubspotMapping.js';

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
eq([byKey['a:b'].status, byKey['a:b'].suggestions.map(m => [m.hubspotId, m.accountId, m.score])], [MAPPING_STATUS.accountOnly, [['3', 'b', 83]]], 'a name starting the same way is a possible match, with its %');
eq(rows.find(r => r.key === 'h:3').suggestions.map(m => [m.accountId, m.hubspotId, m.name]), [['b', '3', 'Acme']], 'a HubSpot-only company is offered the unmatched account it may be');
eq(byKey['a:d'].suggestions, [], 'nothing alike, nothing suggested');
eq(rows.filter(r => r.status === MAPPING_STATUS.hubspotOnly).map(r => r.hubspot[0].id), ['3'], 'an unclaimed HubSpot company is listed on its own');
eq(buildHubspotMapping([], companies).filter(r => r.hubspot.length > 1).map(r => r.hubspot.map(c => c.id)), [['1', '2']], 'same-named unclaimed records share a row');

rows = buildHubspotMapping(accounts, companies, { links: { b: '3' } });
eq(rows.find(r => r.key === 'a:b').how, 'linked', 'a link maps the account');
eq(rows.filter(r => r.status === MAPPING_STATUS.hubspotOnly).length, 0, 'a linked company is no longer HubSpot-only');

// ── name similarity ──────────────────────────────────────────────────────
eq(nameSimilarity('Hines', 'Hines Inc.'), 100, 'corporate suffixes are ignored');
eq(nameSimilarity('Hines Interest', 'Hines Interests') >= 90, true, 'a missing "s" still scores high');
eq(nameSimilarity('Blackstone', 'Blackstone Real Estate') >= 75, true, 'the distinctive word carries a longer name');
eq(nameSimilarity('ABC Capital Partners', 'XYZ Capital Partners') < 60, true, 'sharing only generic words is not a match');
eq(nameSimilarity('Brookfield', 'Nuveen') < 30, true, 'different names score low');
const many = compactMappingCompanies(['Acme One', 'Acme Two', 'Acme Three', 'Acme Four'].map((n, i) => ({ 'Company name': n, 'Company ID': `m${i}` })));
eq(buildHubspotMapping([{ id: 'z', company: 'Acme' }], many)[0].suggestions.length, 3, 'a row shows the best three');

// ── matching by website ──────────────────────────────────────────────────
const sites = compactMappingCompanies([
  { 'Company name': 'Hines Interests LP', 'Company Domain Name': 'hines.com', 'Company ID': '10' },
  { 'Company name': 'Hines', 'Website URL': 'https://www.hines.com/about', 'Company ID': '11' },
  { 'Company name': 'Hines', 'Company Domain Name': '(No value)', 'Company ID': '12' },
  { 'Company name': 'Other Co', 'Company Domain Name': 'other.com', 'Company ID': '13' },
]);
eq(sites.map(c => c.domain), ['hines.com', 'hines.com', '', 'other.com'], 'Company Domain Name or Website URL reads as a domain');
const siteRows = buildHubspotMapping([
  { id: 'h', company: 'Hines', website: 'http://hines.com' },
  { id: 'o', company: 'Totally Different Name', emailDomain: 'other.com' },
], sites);
eq([siteRows[0].how, siteRows[0].hubspot.map(c => c.id)], ['website', ['10', '11', '12']], 'website hits first, same-named records still come along');
eq([siteRows[1].status, siteRows[1].how, siteRows[1].hubspot.map(c => c.id)], [MAPPING_STATUS.matched, 'website', ['13']], 'an email domain matches when the names differ');

// ── status discrepancy ───────────────────────────────────────────────────
eq(statusDiscrepancy('Client', ['Lead']), 'Client here, Lead in HubSpot', 'a Client that is a Lead in HubSpot is flagged');
eq(statusDiscrepancy('Client', ['Lead', 'Customer']), '', 'a Client with a Customer record among duplicates is fine');
eq(statusDiscrepancy('Qualifying', ['Customer']), 'Qualifying here, Customer in HubSpot', 'a HubSpot Customer that is a prospect here is flagged');
eq(statusDiscrepancy('', ['Evangelist']), 'No status here, Evangelist in HubSpot', 'no status here and a customer there is flagged');
eq(statusDiscrepancy('Old Client', ['Customer']), '', 'an Old Client that is a Customer is fine');
eq(statusDiscrepancy('Qualifying', ['Lead']), '', 'a prospect that is a Lead is fine');
eq(statusDiscrepancy('Client', []), '', 'no lifecycle stage in the export, nothing to compare');
const flagRows = buildHubspotMapping([{ id: 'x', company: '3650 REIT', status: 'Client' }], companies);
eq(flagRows[0].statusFlag, 'Client here, Lead in HubSpot', 'a matched row carries the flag');

// ── on the Table tab, not My Accounts ─────────────────────────────────────
const apollo = compactMappingCompanies([{ 'Company name': 'Apollo Global Management', 'Company ID': '20' }]);
const tableRows = buildHubspotMapping([], apollo, { tracker: [{ id: 't', company: 'Apollo Global Management, Inc.', cdm: 'Jane Doe' }, { id: 'u', company: 'Other' }] });
eq([tableRows[0].status, tableRows[0].tracker.map(p => p.id)], [MAPPING_STATUS.hubspotOnly, ['t']], 'a HubSpot-only company on the tracker names the tracker record');
eq(buildHubspotMapping([], apollo)[0].tracker, [], 'no tracker given, no tracker records');

// ── likely duplicates of a matched account ────────────────────────────────
eq(likelyDuplicateName('Silver Lake', 'Silver Lake Partners'), true, 'a dropped "Partners" is the same firm');
eq(likelyDuplicateName('WSP', 'WSP Global'), true, 'a dropped "Global" is the same firm');
eq(likelyDuplicateName('DivcoWest', 'Divco West Properties'), true, 'spacing aside, the same firm');
eq(likelyDuplicateName('Jones Lang LaSalle (JLL)', 'Jones Lang LaSalle'), true, 'the name without its bracketed acronym');
eq(likelyDuplicateName('Teachers Insurance and Annuity Association of America (TIAA)', 'TIAA'), true, 'the acronym on its own, in capitals');
eq(likelyDuplicateName('Alberta Investment Management Corporation (AIMCo)', 'Aimco'), false, 'a different firm spelled like the acronym is not');
eq(likelyDuplicateName('Westinghouse', 'Westinghouse (a Brookfield Co.)'), true, 'an "a ... Co." clause is the same firm');
eq(likelyDuplicateName('Blackstone', 'A&E Real Estate Holdings (a Blackstone Co.)'), false, 'a portfolio company is not');
eq(likelyDuplicateName('Brookfield Asset Management', 'Brookfield (Selenta)'), false, 'a sister company is not');
eq(likelyDuplicateName('Berkeley Partners', 'Berkeley Capital Group'), false, 'more of a different name is not');
eq(likelyDuplicateName('CommonWealth Partners', 'Equity Commonwealth'), false, 'sharing one word is not');
const dupCos = compactMappingCompanies([
  { 'Company name': 'Silver Lake', 'Company ID': '30' },
  { 'Company name': 'Silver Lake Partners', 'Company ID': '31' },
  { 'Company name': 'Silver Lake Partners', 'Company ID': '32' },
  { 'Company name': 'Silverlake Dental', 'Company ID': '33' },
]);
const dupRows = buildHubspotMapping([{ id: 's', company: 'Silver Lake' }], dupCos);
eq(dupRows[0].duplicates.map(c => c.id), ['31', '32'], 'duplicates go on the matched account row');
eq(dupRows.filter(r => r.status === MAPPING_STATUS.hubspotOnly).map(r => r.hubspot[0].id), ['33'], 'and no longer get an Only in HubSpot row');
eq(buildHubspotMapping([{ id: 'n', company: 'Nobody' }], dupCos).every(r => !r.duplicates.length), true, 'no matched account, no duplicates');

const ownCos = compactMappingCompanies([
  { 'Company name': 'Matched Co', 'Company ID': '40', 'Company owner': 'Dan Baldauf' },
  { 'Company name': 'Lonely Co', 'Company ID': '41', 'Company owner': 'Dan Baldauf', 'Company Domain Name': 'lonely.com' },
  { 'Company name': 'Lonely Co', 'Company ID': '42', 'Company owner': 'Dan Baldauf' },
  { 'Company name': 'Other Owner Co', 'Company ID': '43', 'Company owner': 'Pat Smith' },
  { 'Company name': 'No Owner Co', 'Company ID': '44' },
]);
const ownRows = hubspotOnlyOwnedRows(buildHubspotMapping([{ id: 'm', company: 'Matched Co' }], ownCos), 'Dan Baldauf');
eq(ownRows.map(r => r['Record ID']), ['41', '42', '44'], 'Only in HubSpot records owned by Dan (or no owner), each same-named record, matched and other owners left out');
eq(ownRows[0], { 'Record ID': '41', 'Company name': 'Lonely Co', 'Company Domain Name': 'lonely.com', 'Company owner': 'Dan Baldauf' }, 'rows carry the HubSpot import columns');
eq(hubspotOnlyOwnedRows(buildHubspotMapping([], compactMappingCompanies([{ 'Company name': 'No Id Co' }])), 'Dan Baldauf')[0]['Record ID'], '', 'no Company ID column, blank Record ID');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
