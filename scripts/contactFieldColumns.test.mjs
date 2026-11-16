// The contact fields Draft Emails > Variable Coverage can add as columns,
// read the way the contact popup reads them.
//
// Run: node scripts/contactFieldColumns.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { CONTACT_FIELD_COLUMNS, contactFieldColumn, cleanFieldColumnKeys } = await import('../src/utils/contactFieldColumns.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const raw = { id: '7', firstname: 'Mathew', lastname: 'Chamish', jobtitle: 'Director of Sustainability', company: 'CBRE', mobilephone: '555', dans_tags: 'ESG;Decision Maker', hs_linkedin_url: 'https://li/m' };
const ctx = { settings: {
  contactLocalFields: { 7: { _companyOverride: 'CBRE Investment Management' } },
  contactTeamNames: { 7: 'Americas ESG' },
  contactNicknames: { 7: 'Matt' },
  contactFamilies: { 7: { partner: 'Sam', kids: 'Ava' } },
  contactSentiment: { 7: 'champion' },
  contactMetInPerson: { 7: true },
  contactConnected: { 7: true },
} };
const v = (k) => contactFieldColumn(k).get(raw, ctx);
ok(v('jobtitle') === 'Director of Sustainability', 'Job Title');
ok(v('company') === 'CBRE Investment Management', 'Company follows the Company pin');
ok(v('teamName') === 'Americas ESG', 'Team Name from the app');
ok(v('goesBy') === 'Matt', 'Goes By');
ok(v('partner') === 'Sam' && v('kids') === 'Ava', "Partner's and Kids' names");
ok(v('mobilephone') === '555' && v('linkedin') === 'https://li/m', 'Cell phone and LinkedIn');
ok(v('tags') === 'ESG, Decision Maker', 'Tags listed');
ok(v('standing') === 'Champion' && v('metInPerson') === 'Yes' && v('connected') === 'Yes', 'Standing, Met In Person, Connected?');
ok(contactFieldColumn('teamName').get({ id: '8' }, ctx) === '', 'blank when unset');
ok(contactFieldColumn('company').get({ id: '8', company: 'Acme' }, ctx) === 'Acme', 'no pin: HubSpot company');
ok(JSON.stringify(cleanFieldColumnKeys(['jobtitle', 'bogus', 'jobtitle', 'teamName'])) === '["jobtitle","teamName"]', 'saved keys cleaned');
ok(cleanFieldColumnKeys(null).length === 0, 'nothing saved, no columns');
ok(new Set(CONTACT_FIELD_COLUMNS.map(f => f.key)).size === CONTACT_FIELD_COLUMNS.length, 'keys are unique');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
