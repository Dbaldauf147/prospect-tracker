// Assertion tests for the HubSpot import files (src/utils/hubspotImportFiles.js).
// Plain Node, no framework. Run:
//   node scripts/hubspotImportFiles.test.mjs
//
// What has to hold:
//   * a contact is keyed by email, linked to its company by the company's
//     domain, and carries the owner and its tags,
//   * contacts with no email, hidden ones and repeats are left out and
//     counted; free-mail addresses never link a company,
//   * a company pin from the site wins over the synced company text,
//   * an Opp becomes a deal linked to its company's domain and, when its
//     contact name is a contact there, to that contact's email,
//   * only companies with a contact or an Opp go in unless all are asked for,
//   * the fields file lists the tags and deal stages seen in the data.
import { buildImportFiles, domainOf, amountOf, dateOf, CONTACT_HEADERS, DEAL_HEADERS, COMPANY_HEADERS } from '../src/utils/hubspotImportFiles.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const cell = (headers, row, label) => row[headers.indexOf(label)];

eq(domainOf('https://www.Acme.com/about'), 'acme.com', 'domainOf strips scheme, www and path');
eq(domainOf('jane@acme.co.uk'), 'acme.co.uk', 'domainOf reads an email address');
eq(domainOf('not a site'), '', 'domainOf rejects text that is not a domain');
eq([amountOf('$120,000'), amountOf(''), amountOf('n/a')], ['120000', '', ''], 'amounts are digits only');
eq([dateOf('2026-11-30T00:00:00Z'), dateOf('Nov 30, 2026'), dateOf('soon')], ['2026-11-30', '2026-11-30', ''], 'dates become YYYY-MM-DD');

const prospects = [
  { id: 'p1', company: 'Acme Corp', website: 'https://acme.com', vertical: 'Retail', tier: 'Tier 1', status: 'Active', type: 'Corporate' },
  { id: 'p2', company: 'Beta Holdings', aliases: ['Beta'], emailDomain: 'beta.io' },
  { id: 'p3', company: 'Quiet LLC', website: 'quiet.com' },
  { id: 'p4', company: 'No Site Inc' },
];
const contacts = [
  { id: '1', email: 'Jane@Acme.com', firstname: 'Jane', lastname: 'Doe', company: 'ACME', dans_tags: 'ESG;Key' },
  { id: '2', email: 'jane@acme.com', firstname: 'Jane', lastname: 'Again', company: 'Acme' },
  { id: '3', email: '', firstname: 'No', lastname: 'Email' },
  { id: '4', email: 'gone@acme.com', dans_tags: 'hide' },
  { id: '5', email: 'sam@gmail.com', firstname: 'Sam', company: 'Somewhere Else' },
  { id: '6', email: 'bo@beta.io', firstname: 'Bo', lastname: 'Li', company: '' },
  { id: '7', email: 'al@other.com', firstname: 'Al', company: 'Wrong Name' },
  { id: '8', email: 'ni@nosite.com', firstname: 'Ni', company: 'No Site' },
];
const settings = { contactLocalFields: { 7: { _companyOverride: 'Beta' } } };
const opps = [
  { _id: 'o1', Account: 'Acme Corp', Scope: 'Utility Bill Pay', Stage: 'Quoting', 'Quoted Amount': '$50,000', 'Close Date': '2026-12-15', Contact: 'Jane Doe' },
  { _id: 'o2', Account: 'Unknown Co', Scope: 'ESG', Stage: '' },
  { _id: 'o3', Account: 'No Site Inc', Scope: 'Audit', Stage: 'Lead' },
];

const out = buildImportFiles({ prospects, contacts, opps, settings, ownerEmail: 'daniel.baldauf@se.com', pipeline: 'Sales Pipeline' });

// Contacts
{
  const rows = out.contacts.rows;
  eq(rows.map(r => r[0]), ['jane@acme.com', 'sam@gmail.com', 'bo@beta.io', 'al@other.com', 'ni@nosite.com'],
    'contacts keyed by lower-cased email; no-email, hidden and repeats left out');
  eq([out.report.contactsNoEmail, out.report.contactsHidden, out.report.contactsDuplicateEmail], [1, 1, 1], '...and counted');
  const jane = rows[0];
  eq([cell(CONTACT_HEADERS, jane, 'Company Domain Name'), cell(CONTACT_HEADERS, jane, 'Company Name'), cell(CONTACT_HEADERS, jane, "Dan's Tags"), cell(CONTACT_HEADERS, jane, 'Contact owner')],
    ['acme.com', 'Acme Corp', 'ESG;Key', 'daniel.baldauf@se.com'], 'a contact links by domain, carries tags and owner');
  eq(cell(CONTACT_HEADERS, rows[1], 'Company Domain Name'), '', 'a free-mail contact at an unknown company is not linked');
  eq(cell(CONTACT_HEADERS, rows[2], 'Company Domain Name'), 'beta.io', 'no company text: linked by the email domain of an account');
  eq(cell(CONTACT_HEADERS, rows[3], 'Company Domain Name'), 'beta.io', 'the site company pin wins over the synced text (alias match)');
  eq(out.report.contactsNoCompany, 1, 'one contact is included unlinked');
}

// Deals
{
  const [d1, d2, d3] = out.deals.rows;
  eq([cell(DEAL_HEADERS, d1, 'Deal Name'), cell(DEAL_HEADERS, d1, 'Deal Stage'), cell(DEAL_HEADERS, d1, 'Amount'), cell(DEAL_HEADERS, d1, 'Close Date'), cell(DEAL_HEADERS, d1, 'Pipeline')],
    ['Acme Corp - Utility Bill Pay', 'Quoting', '50000', '2026-12-15', 'Sales Pipeline'], 'an Opp becomes a deal');
  eq([cell(DEAL_HEADERS, d1, 'Company Domain Name'), cell(DEAL_HEADERS, d1, 'Contact Email'), cell(DEAL_HEADERS, d1, 'Prospect Tracker ID')],
    ['acme.com', 'jane@acme.com', 'o1'], 'the deal links to its company and to the named contact there');
  eq([cell(DEAL_HEADERS, d2, 'Deal Stage'), cell(DEAL_HEADERS, d2, 'Company Domain Name')], ['Lead', ''], 'no stage reads as Lead; an unknown account is unlinked');
  eq(out.report.dealsNoCompany, ['Unknown Co - ESG'], '...and reported');
  eq(out.report.dealsNoDomain, ['No Site Inc - Audit'], 'a deal whose company has no website is reported');
  eq(d3[0], 'No Site Inc - Audit', 'that deal is still included');
}

// Companies
{
  eq(out.companies.rows.map(r => cell(COMPANY_HEADERS, r, 'Name')), ['Acme Corp', 'Beta Holdings', 'No Site Inc'],
    'only companies with a contact or an Opp');
  eq(out.report.companiesNoDomain, ['No Site Inc'], 'a company with no website is reported');
  const all = buildImportFiles({ prospects, contacts, opps, settings, allCompanies: true });
  eq(all.companies.rows.length, 4, 'every company when asked');
  eq(cell(COMPANY_HEADERS, out.companies.rows[0], 'Tier'), 'Tier 1', 'company fields carry over');
}

// Fields
{
  const tags = out.fields.rows.find(r => r[1] === "Dan's Tags");
  eq(tags[3], 'ESG; Key', 'the fields file lists the tags seen');
  const stages = out.fields.rows.find(r => r[0] === 'Deal' && r[1] === 'Deal Stage');
  eq(stages[3], 'Lead; Quoting', '...and the deal stages used');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
