// Assertion tests for matching Dan's records against what the corporate
// HubSpot portal already holds (src/utils/seHubspotExisting.js), and how the
// import files use it (src/utils/hubspotImportFiles.js). Plain Node, no
// framework. Run:
//   node scripts/seHubspotExisting.test.mjs
//
// What has to hold:
//   * the exports' columns are read by HubSpot's labels, contacts kept only
//     at domains Dan's contacts use,
//   * a company matches by domain, then by name (aliases too); among several
//     the one Dan owns wins; an override picks another or "create new",
//   * a matched company is left out of the companies file, and its contacts
//     link to it by Record ID with its name,
//   * a contact a colleague owns there is left out; Dan's own and unowned
//     ones stay, and each is counted,
//   * every contact carries the legal basis.
import { compactCompanies, compactContacts, companyMatcher, ownerIsMe, domainKey } from '../src/utils/seHubspotExisting.js';
import { buildImportFiles, CONTACT_HEADERS, DEFAULT_LEGAL_BASIS } from '../src/utils/hubspotImportFiles.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const cell = (row, label) => row[CONTACT_HEADERS.indexOf(label)];

// ── reading the exports ──────────────────────────────────────────────────
eq(compactCompanies([
  { 'Record ID': '101', 'Company name': 'Rehlko', 'Company Domain Name': '', 'Website URL': 'https://www.rehlko.com/', 'Company owner': 'Alexis Nickl' },
  { 'Record ID': '102', 'Company name': '', 'Company Domain Name': '' },
  { 'Record ID': '103', 'Company name': 'Acme', 'Company Domain Name': 'ACME.com' },
]), [
  { id: '101', name: 'Rehlko', domain: 'rehlko.com', owner: 'Alexis Nickl' },
  { id: '103', name: 'Acme', domain: 'acme.com', owner: '' },
], 'companies: domain from the domain column or the website; empty rows dropped');
eq(compactContacts([
  { 'Record ID': '1', Email: 'Jane@Acme.com', 'Contact owner': 'Kat Gross' },
  { 'Record ID': '2', Email: 'x@elsewhere.com', 'Contact owner': '' },
], new Set(['acme.com'])), [{ id: '1', email: 'jane@acme.com', owner: 'Kat Gross' }], 'contacts: lower-cased, only at domains that matter');
eq([ownerIsMe('Dan Baldauf', ['daniel.baldauf@se.com', 'Dan Baldauf']), ownerIsMe('Dan Baldauf (daniel.baldauf@se.com)', ['daniel.baldauf@se.com']), ownerIsMe('Kat Gross', ['Dan Baldauf']), ownerIsMe('', ['Dan Baldauf'])],
  [true, true, false, false], 'owner by name or email');
eq(domainKey('jane@sub.acme.co.uk'), 'sub.acme.co.uk', 'domainKey reads emails');

// ── matching companies ───────────────────────────────────────────────────
const portal = [
  { id: '101', name: 'Rehlko', domain: '', owner: 'Alexis Nickl' },
  { id: '201', name: 'Brookfield Asset Management', domain: 'brookfield.com', owner: 'Kat Gross' },
  { id: '202', name: 'Brookfield', domain: 'brookfield.com', owner: 'Dan Baldauf' },
  { id: '301', name: 'Beta Holdings LLC', domain: 'beta.io', owner: '' },
];
{
  const m = companyMatcher(portal, { me: ['Dan Baldauf'] });
  const r = m({ id: 'p1', company: 'Rehlko', website: 'rehlko.com' });
  eq([r.company?.id, r.how], ['101', 'name'], 'no domain on the portal record: matched by name');
  const b = m({ id: 'p2', company: 'Brookfield Renewable', website: 'brookfield.com' });
  eq([b.company?.id, b.candidates.length, b.how], ['202', 2, 'domain'], "among several, the one Dan owns");
  eq(m({ id: 'p3', company: 'Beta', aliases: ['Beta Holdings'], website: 'other.com' }).company?.id, '301', 'aliases match by name');
  eq(m({ id: 'p4', company: 'Nowhere Inc', website: 'nowhere.com' }).how, 'none', 'no match: create new');
  const o = companyMatcher(portal, { me: ['Dan Baldauf'], overrides: { p2: '201', p1: 'new' } });
  eq([o({ id: 'p2', company: 'Brookfield Renewable', website: 'brookfield.com' }).company?.id, o({ id: 'p1', company: 'Rehlko' }).company], ['201', null],
    'overrides pick another candidate, or create new');
}

// ── the files ────────────────────────────────────────────────────────────
{
  const prospects = [
    { id: 'p1', company: 'Rehlko', website: 'rehlko.com' },
    { id: 'p5', company: 'Newco', website: 'newco.com' },
  ];
  const contacts = [
    { id: '1', email: 'francis@rehlko.com', firstname: 'Francis', company: 'Rehlko' },
    { id: '2', email: 'kat-owned@rehlko.com', firstname: 'K', company: 'Rehlko' },
    { id: '3', email: 'mine@rehlko.com', firstname: 'M', company: 'Rehlko' },
    { id: '4', email: 'ann@newco.com', firstname: 'Ann', company: 'Newco' },
  ];
  const existing = {
    companies: portal,
    contacts: [
      { id: '9', email: 'kat-owned@rehlko.com', owner: 'Kat Gross' },
      { id: '10', email: 'mine@rehlko.com', owner: 'Dan Baldauf' },
      { id: '11', email: 'francis@rehlko.com', owner: '' },
    ],
  };
  const out = buildImportFiles({ prospects, contacts, existing, ownerEmail: 'daniel.baldauf@se.com', ownerName: 'Dan Baldauf' });
  eq(out.companies.rows.map(r => r[1]), ['Newco'], 'a company the portal has is left out of the companies file');
  eq(out.report.companiesExisting, [{ name: 'Rehlko', existing: 'Rehlko', id: '101' }], '...and listed');
  eq(out.contacts.rows.map(r => r[0]), ['francis@rehlko.com', 'mine@rehlko.com', 'ann@newco.com'], "a colleague's contact is left out");
  eq(out.report.contactsColleagueOwned, [{ email: 'kat-owned@rehlko.com', owner: 'Kat Gross' }], '...and listed with its owner');
  eq([out.report.contactsExistingMine, out.report.contactsExistingUnowned], [1, 1], "Dan's own and unowned ones are counted");
  const francis = out.contacts.rows[0];
  eq([cell(francis, 'Company Record ID'), cell(francis, 'Company Domain Name'), cell(francis, 'Company Name')], ['101', '', 'Rehlko'],
    'a contact at an existing company links by its Record ID');
  const ann = out.contacts.rows[2];
  eq([cell(ann, 'Company Record ID'), cell(ann, 'Company Domain Name')], ['', 'newco.com'], 'a contact at a new company links by domain');
  eq(out.contacts.rows.every(r => cell(r, "Legal basis for processing contact's data") === DEFAULT_LEGAL_BASIS), true, 'every contact carries the legal basis');
  eq(DEFAULT_LEGAL_BASIS, 'Legitimate interest – prospect/lead', "HubSpot's own option label");

  const none = buildImportFiles({ prospects, contacts, ownerEmail: 'daniel.baldauf@se.com' });
  eq([none.companies.rows.length, none.contacts.rows.length], [2, 4], 'without the exports nothing is matched or left out');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
