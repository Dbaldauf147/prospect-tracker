// Assertion tests for the Hubspot Mapping subtab's "Export HubSpot Import
// File" (src/utils/hubspotImportFile.js). Plain Node, no framework. Run:
//   node scripts/hubspotImportFile.test.mjs
//
// What has to hold:
//   * several HubSpot Company IDs on an account become one Import row each,
//     the name repeated, and an ID is on the sheet once however many
//     accounts carry it,
//   * IDs are written as text (no 5.85E+10, no rounding), and the header
//     row is frozen on every sheet,
//   * domains are lowercase, without http(s)://, www., path or slash,
//   * an account with no ID goes in by domain, or, with no domain either,
//     only onto Review,
//   * Review says why: no ID, Name-only match, a Possible Match or
//     Hubspot Duplicates, several IDs, a HubSpot name that differs,
//   * inactive accounts are in; Only in HubSpot rows are not.
import ExcelJS from 'exceljs';
import { buildHubspotImportSheets, buildHubspotImportWorkbook, normalizeDomain, hubspotIdsOf, hubspotImportFileName, IMPORT_HEADERS, REVIEW_HEADERS } from '../src/utils/hubspotImportFile.js';
import { buildHubspotMapping, compactMappingCompanies } from '../src/utils/hubspotMapping.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// Domain normalization.
eq(normalizeDomain('https://www.Acme.com/about/'), 'acme.com', 'domain: scheme, www., path and case go');
eq(normalizeDomain('http://acme.co.uk/'), 'acme.co.uk', 'domain: trailing slash goes');
eq(normalizeDomain('  WWW.ACME.COM  '), 'acme.com', 'domain: whitespace and capitals go');
eq(normalizeDomain('jane@Acme.com'), 'acme.com', 'domain: an email gives its domain');
eq(normalizeDomain('not a domain'), '', 'domain: junk reads blank');

// IDs off a row: trimmed, split if a cell holds several, the "row-N" stand-in dropped.
eq(hubspotIdsOf({ hubspot: [{ id: ' 58451545973 ' }, { id: '59011786264, 59006173215' }, { id: 'row-4' }] }), ['58451545973', '59011786264', '59006173215'], 'ids: trimmed, split, stand-in dropped');

// A mapping built the way the tab builds it.
const companies = compactMappingCompanies([
  { 'Company name': 'Acme Realty', 'Company ID': '58451545973', 'Company Domain Name': 'acme.com' },
  { 'Company name': 'Acme Realty', 'Company ID': '59011786264' },
  { 'Company name': 'Acme Realty', 'Company ID': '59006173215' },
  { 'Company name': 'Blue Owl Capital LLC', 'Company ID': '60000000001', 'Company Domain Name': 'blueowl.com' },
  { 'Company name': 'Silver Lake', 'Company ID': '60000000002' },
  { 'Company name': 'Silver Lake Partners', 'Company ID': '60000000003' },
  { 'Company name': 'Zed Holdings', 'Company ID': '60000000004' },
  { 'Company name': 'Nobody Owns Me', 'Company ID': '60000000005' },
]);
const accounts = [
  { id: 'a', company: 'Acme Realty', website: 'https://www.acme.com/' },
  { id: 'b', company: 'Owl', website: 'blueowl.com' },
  { id: 'c', company: 'Silver Lake' },
  { id: 'd', company: 'Gamma Group', website: 'HTTPS://WWW.Gamma.IO/contact' },
  { id: 'e', company: 'Delta', status: 'Old Client' },
  { id: 'f', company: 'Zed Holdings Inc.' },
  { id: 'g', company: 'Zed Holdings' },
];
const mapping = buildHubspotMapping(accounts, companies, { links: { b: '60000000001' } });
const reference = [
  { label: 'My Accounts', value: r => r.account?.company || '' },
  { label: 'HubSpot Company ID', value: r => r.hubspot.map(c => c.id).join(', ') },
  { label: 'Account Status', value: r => r.account?.status || '' },
];
const sheets = buildHubspotImportSheets(mapping, { reference });
const imp = sheets.importRows;
const rev = Object.fromEntries(sheets.reviewRows.map(r => [r['Tracker Name'], r]));

eq(imp.filter(r => r['Tracker Name'] === 'Acme Realty').map(r => r['Record ID']), ['58451545973', '59011786264', '59006173215'], 'multi-ID: one Import row per ID');
eq(imp.filter(r => r['Tracker Name'] === 'Acme Realty').map(r => r.Name), ['Acme Realty', 'Acme Realty', 'Acme Realty'], 'multi-ID: name repeated on each');
eq(imp.filter(r => r['Record ID'] === '60000000004').length, 1, 'an ID two accounts share is on Import once');
eq(new Set(imp.map(r => r['Record ID']).filter(Boolean)).size, imp.filter(r => r['Record ID']).length, 'no Record ID repeats');
eq(imp.find(r => r['Tracker Name'] === 'Gamma Group'), { 'Record ID': '', 'Company Domain Name': 'gamma.io', Name: '', 'Tracker Name': 'Gamma Group' }, 'no ID: goes in by normalized domain, Record ID blank');
eq(imp.some(r => r['Tracker Name'] === 'Delta'), false, 'no ID and no domain: left off Import');
eq(imp.some(r => r['Record ID'] === '60000000005'), false, 'Only in HubSpot rows are left out');
eq(sheets.counts.accounts, 7, 'every account counted, the inactive one too');
eq(sheets.referenceRows.length, 7, 'Reference: one row per account');
eq(sheets.referenceRows.find(r => r['My Accounts'] === 'Acme Realty')['HubSpot Company ID'], '58451545973, 59011786264, 59006173215', 'Reference: IDs not split');
eq(sheets.referenceRows.find(r => r['My Accounts'] === 'Delta')['Account Status'], 'Old Client', 'Reference: inactive account is there');

// Review reasons.
eq(rev['Delta'].Reason.includes('No HubSpot Company ID and no domain available'), true, 'Review: no ID, nothing available');
eq(rev['Gamma Group'].Reason.includes('No HubSpot Company ID, imported by domain gamma.io'), true, 'Review: no ID, domain used');
eq(rev['Acme Realty'].Reason.includes('3 HubSpot Company IDs: 58451545973, 59011786264, 59006173215'), true, 'Review: several IDs listed');
eq(rev['Acme Realty']['HubSpot Company ID(s)'], '58451545973, 59011786264, 59006173215', 'Review: IDs cell lists them all');
eq(rev['Silver Lake'].Reason.includes('Matched by Name only'), true, 'Review: Name-only match');
eq(rev['Silver Lake'].Reason.includes('Has Hubspot Duplicates'), true, 'Review: Hubspot Duplicates');
eq(rev['Silver Lake']['Hubspot Duplicates'], 'Silver Lake Partners (60000000003)', 'Review: duplicates listed');
eq(rev['Owl'].Reason.includes('HubSpot name differs: Blue Owl Capital LLC'), true, 'Review: HubSpot name differs');
eq(rev['Owl']['Matched By'], 'Your link', 'Review: Matched By shown');
eq(rev['Zed Holdings Inc.'].Reason.includes('differs'), false, 'Review: "Inc." alone is not a different name');
const possible = buildHubspotImportSheets([{ account: { company: 'Northwind' }, hubspot: [], how: '', suggestions: [{ name: 'Northwind Traders', score: 88 }], duplicates: [] }]);
eq(possible.reviewRows[0].Reason.includes('Has a Possible Match'), true, 'Review: Possible Match');
eq(possible.reviewRows[0]['Possible Match'], 'Northwind Traders (88%)', 'Review: Possible Match listed');
eq(buildHubspotImportSheets([{ account: { company: 'Acme' }, hubspot: [{ id: '1', name: 'Acme' }], how: 'website', suggestions: [], duplicates: [] }]).reviewRows.length, 0, 'Review: a clean website match is not flagged');

eq(hubspotImportFileName(new Date(2026, 9, 5)), 'hubspot-company-import-2026-10-05.xlsx', 'file name');

// The written file: IDs as text, header frozen, headers exact.
const wb = buildHubspotImportWorkbook(ExcelJS.Workbook, sheets);
const back = new ExcelJS.Workbook();
await back.xlsx.load(await wb.xlsx.writeBuffer());
eq(back.worksheets.map(w => w.name), ['Import', 'Review', 'Reference'], 'three sheets, in order');
const ws = back.getWorksheet('Import');
eq(ws.getRow(1).values.slice(1), IMPORT_HEADERS, 'Import headers exact');
eq(back.getWorksheet('Review').getRow(1).values.slice(1), REVIEW_HEADERS, 'Review headers exact');
const idCell = ws.getCell('A2');
eq([typeof idCell.value, idCell.value, idCell.numFmt], ['string', '58451545973', '@'], 'Record ID is stored as text');
eq(back.worksheets.map(w => [w.views[0]?.state, w.views[0]?.ySplit]), [['frozen', 1], ['frozen', 1], ['frozen', 1]], 'header row frozen on each sheet');
eq(ws.getColumn(1).width >= 13, true, 'Record ID column wide enough for 11 digits');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
