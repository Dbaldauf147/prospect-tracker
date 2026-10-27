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
//   * Opps are not exported as deals; they only mark a company as a live
//     account,
//   * only companies with a contact or an Opp go in unless all are asked for,
//   * the fields file lists the tags seen in the data, and no deal fields,
//   * activity history is one dated line per activity, newest first,
//     repeats counted once, trimmed oldest-first under HubSpot's cap, and
//     merged across contacts that share an email.
import { buildImportFiles, liveOpps, formatActivityHistory, domainOf, amountOf, dateOf, CONTACT_HEADERS, COMPANY_HEADERS } from '../src/utils/hubspotImportFiles.js';

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

// liveOpps: _deletedIds is a map of id -> deletedAt in the real data (the
// first build on the live site died on `.map` of it).
eq(liveOpps({ records: [{ _id: 'a' }, { _id: 'b' }, { id: 'c' }], _deletedIds: { b: 1730000000000 } }).map(r => r._id ?? r.id), ['a', 'c'],
  'deleted Opps (id -> deletedAt map) are dropped');
eq(liveOpps({ records: [{ _id: 'a' }, { _id: 'b' }], _deletedIds: ['a'] }).map(r => r._id), ['b'], 'a plain list of deleted ids works too');
eq([liveOpps(null), liveOpps({ records: [{ _id: 'a' }] }).length], [[], 1], 'no dataset or no deletions');

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

const out = buildImportFiles({ prospects, contacts, opps, settings, ownerEmail: 'daniel.baldauf@se.com' });

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

// Opps
{
  eq(out.deals, undefined, 'no deals file');
  const oppOnly = buildImportFiles({
    prospects: [{ id: 'q1', company: 'Opp Only Co', website: 'opponly.com' }, { id: 'q2', company: 'Idle Co', website: 'idle.com' }],
    opps: [{ _id: 'x', Account: 'Opp Only Co' }],
  });
  eq(oppOnly.companies.rows.map(r => r[1]), ['Opp Only Co'], 'a company with an Opp but no contacts is still exported');
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
  eq(out.fields.rows.filter(r => r[0] === 'Deal').length, 0, 'no deal fields to create');
}

// Activity history
{
  const d = (s) => Date.parse(`${s}T12:00:00Z`);
  const h = formatActivityHistory([
    [d('2026-09-01'), 'Meeting', 'Review'],
    [d('2026-10-21'), 'Email sent', 'Pilot'],
    [d('2026-10-21'), 'Email sent', 'Pilot'],
  ]);
  eq(h, { history: '2026-10-21 Email sent: Pilot\n2026-09-01 Meeting: Review', lastDate: '2026-10-21', count: 2 },
    'newest first, one line each, repeats once');
  eq(formatActivityHistory([]), { history: '', lastDate: '', count: 0 }, 'no activity: blank fields');
  const many = Array.from({ length: 50 }, (_, i) => [d('2026-01-01') + i * 86400000, 'Email sent', `Message number ${i}`]);
  const capped = formatActivityHistory(many, 200);
  eq([capped.history.length <= 200, capped.count, /\(\+\d+ older not shown\)$/.test(capped.history), capped.history.startsWith('2026-02-19')],
    [true, 50, true, true], 'trimmed oldest-first under the cap, saying how many were dropped');

  const withAct = buildImportFiles({
    prospects, contacts, settings,
    activity: { 1: [[d('2026-10-21'), 'Email sent', 'Hi']], 2: [[d('2026-08-01'), 'Meeting', 'Intro']] },
  });
  const jane = withAct.contacts.rows[0];
  eq([cell(CONTACT_HEADERS, jane, 'Activity History'), cell(CONTACT_HEADERS, jane, 'Last Activity Date'), cell(CONTACT_HEADERS, jane, 'Activity Count')],
    ['2026-10-21 Email sent: Hi\n2026-08-01 Meeting: Intro', '2026-10-21', '2'], 'history of contacts sharing an email lands on the one row');
  eq(withAct.report.contactsWithHistory, 1, 'contacts with history are counted');
  eq(cell(CONTACT_HEADERS, out.contacts.rows[0], 'Activity History'), '', 'no activity given: blank');
  eq(out.fields.rows.filter(r => r[0] === 'Contact').map(r => r[1]).slice(-3), ['Activity History', 'Last Activity Date', 'Activity Count'], 'the history fields are in the fields file');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
