// Assertion tests for the Hubspot Mapping page's Contacts subtab
// (src/utils/hubspotContacts.js). Plain Node. Run:
//   node scripts/hubspotContacts.test.mjs
import {
  contactColumns, contactDisplayName, contactKey, compactContacts, contactMatcher, contactRows, contactOwnerSummary,
} from '../src/utils/hubspotContacts.js';
import { buildHubspotMapping, compactMappingCompanies, pastedSheetRows } from '../src/utils/hubspotMapping.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// Dan's paste, two ZoomInfo and two Company ID columns as in the export.
const H = 'ZoomInfo Company ID\tCompany ID\tCompany name\tCompany owner\tContact Name\tJob Title\tContact owner\tCreate Date\tEmail\tWork email\tEmail Domain\tLast Contacted\tPhone Number\tLinkedIn URL\tZoomInfo Company ID\tCompany ID\tContact ID';
const paste = [H,
  '32883297\t58476263544\tRioCan Real Estate Investment Trust\tDan Baldauf\t(No value)\tSenior Analyst, Sustainability\tElie Bou-Gharios\t9/24/2026 14:44\thnatu@riocan.com\t(No value)\triocan.com\t10/12/2026 13:58\t(416) 824-4210\thttps://www.linkedin.com/in/harsh-natu\t32883297\t58476263544\t2.50699E+11',
  '32883297\t58476263544\tRioCan Real Estate Investment Trust\tDan Baldauf\t(No value)\tSenior Manager, Environmental Risk\tDan Baldauf\t10/8/2026 10:16\tcostrowka@riocan.com\t(No value)\triocan.com\t(No value)\t(No value)\t(No value)\t(No value)\t58476263544\t2.53822E+11',
  '46566601\t58121414223\tLendlease\tDan Baldauf\tHead of Estates\tHead of Estates\tRyan Collins\t9/7/2026 5:27\tliam.side@lendlease.com\t(No value)\tlendlease.com\t(No value)\t +44 7701 092298\t(No value)\t(No value)\t58121414223\t2.46905E+11',
  '46566601\t58121414223\tLendlease\tDan Baldauf\tAngela Park\tSustainability Manager\tElie Bou-Gharios\t9/24/2026 14:44\tangela.park@lendlease.com\t(No value)\tlendlease.com\t(No value)\t(615) 720-6184\thttps://www.linkedin.com/in/angelapark1\t46566601\t58121414223\t2.50712E+11',
  '1\t99\tSomebody Else\tPat Lee\t(No value)\tCFO\tPat Lee\t9/7/2026 5:27\tcfo@kenco.com\t(No value)\tkenco.com\t(No value)\t(No value)\t(No value)\t(No value)\t99\t2.4E+11',
].join('\n');

const cols = contactColumns(H.split('\t'));
check('columns', [cols.companyId, cols.zoomInfoId, cols.contactName, cols.contactOwner, cols.email, cols.contactId, cols.firstName], ['Company ID', 'ZoomInfo Company ID', 'Contact Name', 'Contact owner', 'Email', 'Contact ID', '']);

const { contacts } = compactContacts(pastedSheetRows(paste));
check('every contact read', contacts.length, 5);
check('first contact', contacts[0], {
  contactId: '250699000000', contactName: '', firstName: '', lastName: '', jobTitle: 'Senior Analyst, Sustainability', contactOwner: 'Elie Bou-Gharios',
  email: 'hnatu@riocan.com', workEmail: '', emailDomain: 'riocan.com', phone: '(416) 824-4210', linkedIn: 'https://www.linkedin.com/in/harsh-natu',
  created: '2026-09-24 14:44', lastContacted: '2026-10-12 13:58', companyId: '58476263544', zoomInfoId: '32883297',
  companyName: 'RioCan Real Estate Investment Trust', companyOwner: 'Dan Baldauf',
});
check('a job title in Contact Name is no name', contactDisplayName(contacts[2]), '');
check('a real Contact Name is kept', contactDisplayName(contacts[3]), 'Angela Park');
check('First and Last win', contactDisplayName({ firstName: 'Liam', lastName: 'Side', contactName: 'Head of Estates' }), 'Liam Side');
check('the same contact twice reads once', compactContacts(pastedSheetRows([H, paste.split('\n')[1], paste.split('\n')[1]].join('\n'))).contacts.length, 1);
check('one contact on two companies is two', contactKey({ email: 'a@x.com', companyId: '1' }) === contactKey({ email: 'a@x.com', companyId: '2' }), false);
check('a row with nothing to know it by is dropped', compactContacts([{ 'Company name': 'X', 'Job Title': 'CFO' }]).contacts.length, 0);

const accounts = [
  { id: 'a1', company: 'RioCan', website: 'https://www.riocan.com' },
  { id: 'a2', company: 'Lendlease' },
  { id: 'a3', company: 'Kenco Logistics', emailDomain: 'kenco.com' },
  { id: 'a4', company: 'Gmail Co', emailDomain: 'gmail.com' },
];
const mapping = buildHubspotMapping(accounts, compactMappingCompanies([
  { 'Company ID': '58476263544', 'Company name': 'RioCan Real Estate Investment Trust', 'Company Domain Name': 'riocan.com' },
]), {});
const match = contactMatcher(mapping, accounts);
check('by Company ID', match(contacts[0])?.row.account.company, 'RioCan');
check('by company name', [match(contacts[2])?.row.account.company, match(contacts[2])?.how], ['Lendlease', 'Name']);
check('by email domain', [match(contacts[4])?.row.account.company, match(contacts[4])?.how], ['Kenco Logistics', 'Email domain']);
check('personal mail never matches', match({ companyId: '', companyName: '', emailDomain: 'gmail.com' }), null);

const rows = contactRows(contacts, match, 'Dan Baldauf');
check('rows', rows.map(r => [r.account?.company || '', r.name, r.mine]), [['RioCan', '', false], ['RioCan', '', true], ['Lendlease', '', false], ['Lendlease', 'Angela Park', false], ['Kenco Logistics', '', false]]);
check('other owners', contactOwnerSummary(rows, 'Dan Baldauf'), [{ name: 'Elie Bou-Gharios', count: 2 }, { name: 'Pat Lee', count: 1 }, { name: 'Ryan Collins', count: 1 }]);

console.log(`${failed ? 'FAIL' : 'PASS'} hubspotContacts: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
