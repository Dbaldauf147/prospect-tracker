// Who is on a company's roster: the company card's Contacts tab and the
// Events Name picker both read this rule. Run:
//   node scripts/companyRoster.test.mjs
import { companyRosterContacts, companyEmailDomains, companiesMatch } from '../src/utils/companyRoster.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const ids = (list) => list.map(c => c.id);
const isHidden = (c) => !!c.hidden;

const contacts = [
  { id: '1', company: 'TIAA', email: 'a@tiaa.org' },
  { id: '2', company: '', email: 'b@tiaa.org' },
  { id: '3', company: 'Nuveen', email: 'c@tiaa.org' },
  { id: '4', company: 'Someone Else', email: 'd@else.com' },
  { id: '5', company: 'TIAA', email: 'e@tiaa.org', hidden: true },
  { id: '6', company: '', email: 'f@gmail.com' },
  { id: '7', company: 'Teachers Insurance', email: 'g@tiaa.org' },
];
const tiaa = { company: '(TIAA) Teachers Insurance and Annuity Association of America', emailDomain: 'tiaa.org' };

eq(ids(companyRosterContacts(contacts, tiaa, { isHidden })), ['1', '2'],
  'name alias and blank-Company domain match; other Company text (even on the domain) stays off; hidden off');
eq(ids(companyRosterContacts(contacts, tiaa, { isHidden, showHidden: true })), ['1', '2', '5'],
  'Show hidden brings the hide-tagged contact back');
eq(ids(companyRosterContacts(contacts, tiaa, { isHidden, links: { [tiaa.company.toLowerCase()]: ['4', '5'] } })), ['1', '2', '4'],
  'a linked contact is added whatever its Company; a hidden link stays hidden');
eq(ids(companyRosterContacts(contacts, tiaa, { isHidden, exclusions: { [tiaa.company.toLowerCase()]: ['2'] } })), ['1'],
  'a removed contact stays off');
eq(ids(companyRosterContacts(contacts, { ...tiaa, exactContactMatch: true }, { isHidden })), [],
  'exact match takes only the exact name and no domain matches');
eq(ids(companyRosterContacts(contacts, { company: 'TIAA', exactContactMatch: true }, { isHidden })), ['1'],
  'exact match on the exact name');
eq(ids(companyRosterContacts([{ id: '1', company: 'Brookfield' }, { id: '2', company: 'Brookfield (Self Storage)' }], { company: 'Brookfield (Self Storage)' })), ['2'],
  'a division bracket only takes contacts at that division');
eq(companyRosterContacts(contacts, { company: '' }), [], 'no company, no roster');
eq([...companyEmailDomains({ emailDomain: 'x@acme.com; acme.co.uk', website: 'https://www.acme.io/about' })], ['acme.com', 'acme.co.uk', 'acme.io'],
  'email domains from addresses, bare domains and the website');
eq(companiesMatch('Jones Lang LaSalle (JLL)', 'JLL'), true, 'one-word bracket reads as an alias');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
