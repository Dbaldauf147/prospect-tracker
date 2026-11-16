// Issues: Key Contacts with no LinkedIn URL (src/utils/keyContactLinkedin.js).
// Run: node scripts/keyContactLinkedin.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { keyContactLinkedinIssues, cleanLinkedinUrl, markNoLinkedinUpdate, KEY_CONTACT_LINKEDIN_ISSUE } = await import('../src/utils/keyContactLinkedin.js');
const { computeIssues } = await import('../src/utils/clientIssues.js');

let passed = 0, failed = 0;
function ok(c, n) { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}`); } }

const contacts = [
  { id: '1', firstname: 'Stephen', lastname: 'Smith', company: 'Simon Property Group', jobtitle: 'SVP Ops', dans_tags: 'Dan Key Target' },
  { id: '2', firstname: 'Has', lastname: 'Url', company: 'Acme', dans_tags: 'Dan Key Target', hs_linkedin_url: 'https://www.linkedin.com/in/hasurl' },
  { id: '3', firstname: 'Not', lastname: 'Key', company: 'Acme', dans_tags: 'Decision Maker' },
  { id: '4', firstname: 'Gone', lastname: 'Person', company: 'Acme', dans_tags: 'Dan Key Target;Left' },
  { id: '5', firstname: 'Ann', lastname: 'Alpha', company: 'Acme', dans_tags: 'dan key target' },
  { id: '6', firstname: 'No', lastname: 'Profile', company: 'Acme', dans_tags: 'Dan Key Target' },
  { id: '7', firstname: 'Typed', lastname: 'Co', company: '', dans_tags: 'Dan Key Target', linkedin_url: '' },
];
const prospects = [{ id: 'p1', company: 'Acme' }];
const rows = keyContactLinkedinIssues(contacts, { prospects, noLinkedin: { 6: '2026-11-16' }, localFields: { 7: { _companyOverride: 'Zeta Corp' } } });
ok(rows.length === 3, `three Key Contacts flagged (got ${rows.length}: ${rows.map(r => r.resolve.name).join(', ')})`);
ok(!rows.some(r => r.resolve.contactId === '2'), 'a contact with a LinkedIn URL is not flagged');
ok(!rows.some(r => ['3', '4'].includes(r.resolve.contactId)), 'not a Key Contact / left: not flagged');
ok(!rows.some(r => r.resolve.contactId === '6'), 'marked as having no LinkedIn profile: cleared');
ok(rows[0].company === 'Acme' && rows[0].prospectId === 'p1', 'sorted by company, linked to its Table View company');
ok(rows.find(r => r.resolve.contactId === '7')?.company === 'Zeta Corp', 'a typed-in company is used');
ok(rows.every(r => r.type === KEY_CONTACT_LINKEDIN_ISSUE && r.source === 'Agents' && r.id.startsWith('key-contact-no-linkedin:')), 'row shape');
ok(rows.find(r => r.resolve.contactId === '1').detail.startsWith('Stephen Smith (SVP Ops)'), 'detail names the contact');
ok(!/—/.test(JSON.stringify(rows)), 'no em dash');
ok(rows.find(r => r.resolve.contactId === '1').resolve.linkedinSearchUrl === 'https://www.linkedin.com/search/results/people/?keywords=Stephen%20Smith%20Simon%20Property%20Group', 'LinkedIn search is name + company');
ok(rows.find(r => r.resolve.contactId === '7').resolve.linkedinSearchUrl.endsWith('Typed%20Co%20Zeta%20Corp'), 'LinkedIn search uses a typed-in company');
{
  const [r] = keyContactLinkedinIssues([{ id: '9', email: 'x@y.com', company: 'Acme', dans_tags: 'Dan Key Target' }]);
  ok(r && r.resolve.linkedinSearchUrl === '', 'no name: no LinkedIn search');
}
const all = computeIssues({ keyContactLinkedin: rows });
ok(all.filter(r => r.type === KEY_CONTACT_LINKEDIN_ISSUE).length === 3, 'computeIssues includes them');

ok(cleanLinkedinUrl('linkedin.com/in/x') === 'https://linkedin.com/in/x', 'adds https://');
ok(cleanLinkedinUrl(' https://www.linkedin.com/in/x/ ') === 'https://www.linkedin.com/in/x/', 'keeps a full URL');
ok(cleanLinkedinUrl('https://example.com/x') === '' && cleanLinkedinUrl('') === '', 'refuses anything else');
const up = markNoLinkedinUpdate('9', 'T')({ keyContactNoLinkedin: { 6: 'S' } });
ok(up.keyContactNoLinkedin['9'] === 'T' && up.keyContactNoLinkedin['6'] === 'S', 'marks no profile, keeps the rest');
ok(markNoLinkedinUpdate('9')({ keyContactNoLinkedin: { 9: 'T' } }) === null, 'already marked: no save');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
